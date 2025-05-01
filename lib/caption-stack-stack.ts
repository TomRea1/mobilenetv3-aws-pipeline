
// Import dependencies 
import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3  from 'aws-cdk-lib/aws-s3';
import * as sm  from 'aws-cdk-lib/aws-sagemaker';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';


// Outline the aws resources to be used 
export class CaptionStackStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    // Instantiate VPC with 2 availability zones 
    // 2 nat gateways (one for each public subnet)
    // create 4 subnets - 1 private, 1 public in each AZ 
    // private subnets are private with egress to allow for 
    // private direct access to ECR (Sagemaker auto-generates an ECR image
    // with torch dependencies and stuff + training script), 
    // + S3, Sagemaker etc 

    // CIDR Mask 24 meaning 
    const vpc = new ec2.Vpc(this, 'CaptionVpc', {
      maxAzs: 2,                        
      natGateways: 2,                     
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
      restrictDefaultSecurityGroup: false,
    });

    // Add S3 Gateway endpoint so instances in private subnet can have access to
    // direct access to resources outside the VPC 
    vpc.addGatewayEndpoint('S3Gw', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
    });

    // Make our s3 bucket which will hold the model and the training data 
    const assetBucket = s3.Bucket.fromBucketName(
      this,
      'ModelBucket',
      'cdk-hnb659fds-assets-564750642551-eu-north-1',
    );
    
    // Give sagemaker an IAM role allowing jobs to access the s3 bucket
    // Also give it permission to read from the ECR which will contain the training and pipeline
    // scripts + dependencies in a container 
    const sagemakerRole = new iam.Role(this, 'SageMakerExecRole', {
      assumedBy: new iam.ServicePrincipal('sagemaker.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3ReadOnlyAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'),
      ],
    });

    // Create a security group for the sagemaker endpoint allowing other resources 
    // in the VPC (Lambda) to invoke it 
    const endpointSg = new ec2.SecurityGroup(this, 'SmEndpointSG', {
      vpc,
      description: 'Allow HTTPS from VPC to SageMaker endpoint',
      allowAllOutbound: true,
    });

    // Instantiate model - sagemaker needs to know 
    const model = new sm.CfnModel(this, 'CaptionModel', {
      executionRoleArn: sagemakerRole.roleArn,
      primaryContainer: {
        image: '763104351884.dkr.ecr.eu-north-1.amazonaws.com/' +
               'pytorch-inference:2.0.0-cpu-py310-ubuntu20.04-sagemaker',
        modelDataUrl: `s3://${assetBucket.bucketName}/model.tar.gz`,
      },
      vpcConfig: {
        subnets: vpc.privateSubnets.map(s => s.subnetId),
        securityGroupIds: [endpointSg.securityGroupId],
      },
    });

    // SageMaker endpoint configuration - what ec2 instance type to use
    const endpointConfig = new sm.CfnEndpointConfig(this, 'CaptionEndpointConfig', {
      productionVariants: [{
        modelName: model.attrModelName,
        variantName: 'AllTraffic',
        instanceType: 'ml.m5.xlarge',
        initialInstanceCount: 1,
      }],
      // Enable data capture for input / output logs - has to be done for 
      // checking model performance too - logs land in s3 
      dataCaptureConfig: {
        enableCapture: true,
        initialSamplingPercentage: 100,
        destinationS3Uri: `s3://${assetBucket.bucketName}/datacapture/`,
        captureOptions: [{ captureMode: 'Input' }, { captureMode: 'Output' }],
      },
    });

    // Create the endpoint itself - based on endpointCongig specs above
    const endpoint = new sm.CfnEndpoint(this, 'CaptionEndpoint', {
      endpointConfigName: endpointConfig.attrEndpointConfigName,
    });

    endpointConfig.addDependency(model);
    endpoint.addDependency(endpointConfig);
  


//Lambdas 

const triggerFn = new lambda.Function(this, 'TriggerPipelineFn', {
  runtime: lambda.Runtime.PYTHON_3_9,
  code: lambda.Code.fromAsset('lambda/trigger'), // folder with .py & requirements.txt
  handler: 'trigger_pipeline_fn.handler',
  environment: { PIPELINE_NAME: 'CaptionModelPipeline' },
  vpc, subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
  securityGroups: [endpointSg],
});

assetBucket.addEventNotification(
  s3.EventType.OBJECT_CREATED_PUT,
  new s3n.LambdaDestination(triggerFn),
  { prefix: 'train-images/' }
);

const deployFn = new lambda.Function(this, 'DeployIfGoodFn', {
  runtime: lambda.Runtime.PYTHON_3_9,
  code: lambda.Code.fromAsset('lambda/deploy'),
  handler: 'deploy_if_good_fn.handler',
  environment: {
    SM_ROLE_ARN: sagemakerRole.roleArn,
    ENDPOINT_NAME: endpoint.ref,
    INFERENCE_IMAGE: '763104351884.dkr.ecr.eu-north-1.amazonaws.com/pytorch-inference:2.0.0-cpu-py310-ubuntu20.04-sagemaker',
    VPC_CONFIG: JSON.stringify({
      Subnets: vpc.privateSubnets.map(s=>s.subnetId),
      SecurityGroupIds: [endpointSg.securityGroupId],
    }),
  },
  vpc, vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
  securityGroups: [endpointSg],
});

new events.Rule(this, 'PipelineSuccessRule', {
  eventPattern: {
    source: ['aws.sagemaker'],
    detailType: ['SageMaker Model Building Pipeline Execution Status Change'],
    detail: { pipelineName: ['CaptionModelPipeline'], currentPipelineExecutionStatus: ['Succeeded'] },
  },
  targets: [new targets.LambdaFunction(deployFn)],
});


triggerFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['sagemaker:StartPipelineExecution'],
  resources: ['*'],
}));
deployFn.addToRolePolicy(new iam.PolicyStatement({
  actions: [
    'sagemaker:CreateModel',
    'sagemaker:CreateEndpointConfig',
    'sagemaker:UpdateEndpoint',
    'sagemaker:DescribeEndpoint',
  ],
  resources: ['*'],
}));



}
}