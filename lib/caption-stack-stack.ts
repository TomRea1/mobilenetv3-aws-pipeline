// Import dependencies
import { Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2      from 'aws-cdk-lib/aws-ec2';
import * as iam      from 'aws-cdk-lib/aws-iam';
import * as s3       from 'aws-cdk-lib/aws-s3';
import * as sm       from 'aws-cdk-lib/aws-sagemaker';
import * as lambda   from 'aws-cdk-lib/aws-lambda';
import * as s3n      from 'aws-cdk-lib/aws-s3-notifications';
import * as events   from 'aws-cdk-lib/aws-events';
import * as targets  from 'aws-cdk-lib/aws-events-targets';

export class CaptionStackStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    
    // create the VPC with two area zones 
    // two nat gateways - one for each public subnet to fascilitate internet comms 
    // CIDR mask 24 for each - 251 IP range for each (256 - 5 held by AWS )
    const vpc = new ec2.Vpc(this, 'CaptionVpc', {
      maxAzs: 2,
      natGateways: 2,
      subnetConfiguration: [
        { name: 'public',  subnetType: ec2.SubnetType.PUBLIC,              cidrMask: 24 },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
      restrictDefaultSecurityGroup: false,
    });

    // Add the vpc gateway endpoint for private comms with s3 from the private subnet
    vpc.addGatewayEndpoint('S3Gw', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
    });

    // initialise ingest bucket for data 
    const ingestBucket = new s3.Bucket(this, 'IngestBucket', {
      removalPolicy: RemovalPolicy.DESTROY,  
      autoDeleteObjects: true,
    });

    // create asset bucket for the models 
    const assetBucket = s3.Bucket.fromBucketName(
      this, 'ModelBucket', 'cdk-hnb659fds-assets-564750642551-eu-north-1',
    );

    // create a sagemaker role so it can read from the s3 + fetch container image from ECR for training
    const sagemakerRole = new iam.Role(this, 'SageMakerExecRole', {
      assumedBy: new iam.ServicePrincipal('sagemaker.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3ReadOnlyAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'),
      ],
    });

    // security grouop for SM allow comms between VPC resources and sm endpoint 
    const endpointSg = new ec2.SecurityGroup(this, 'SmEndpointSG', {
      vpc,
      description: 'Allow HTTPS from VPC to SageMaker endpoint',
      allowAllOutbound: true,
    });

    // create model object to give to sagemaker endpoitn config (also EC2 for training)+ permissions
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

    // outline endpoint config - instance, model + data capture 
    const endpointConfig = new sm.CfnEndpointConfig(this, 'CaptionEndpointConfig', {
      productionVariants: [{
        modelName: model.attrModelName,
        variantName: 'AllTraffic',
        instanceType: 'ml.m5.xlarge',
        initialInstanceCount: 1,
      }],
      dataCaptureConfig: {
        enableCapture: true,
        initialSamplingPercentage: 100,
        destinationS3Uri: `s3://${assetBucket.bucketName}/datacapture/`,
        captureOptions: [{ captureMode: 'Input' }, { captureMode: 'Output' }],
      },
    });

    // create endpoint + set dependencies ( model and endpoint config - otherwise wont run)
    const endpoint = new sm.CfnEndpoint(this, 'CaptionEndpoint', {
      endpointConfigName: endpointConfig.attrEndpointConfigName,
    });

    endpointConfig.addDependency(model);
    endpoint.addDependency(endpointConfig);

    // Lambdas 

    // set trigger function 
    // - runtime for script
    // - actual script path in app 
    // - environment to run in 
    // - vpc settings + security group so it knows where it is and who its allowed talk to 
    const triggerFn = new lambda.Function(this, 'TriggerPipelineFn', {
      runtime: lambda.Runtime.PYTHON_3_9,
      code:    lambda.Code.fromAsset('lambda/trigger'),
      handler: 'trigger_pipeline_fn.handler',
      environment: { PIPELINE_NAME: 'CaptionModelPipeline' },
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [endpointSg],
    });

    // event notification for bucket - if new data - trigger pipelein function 
    // specify which directory itll trigger if new data goes in 
    ingestBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED_PUT,
      new s3n.LambdaDestination(triggerFn),
      { prefix: 'train-images/' },
    );

    // permission for trigger func to actually do what its entire purpose is - wont
    // run without this I learned the hard way 
    triggerFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['sagemaker:StartPipelineExecution'],
      resources: ['*'],
    }));

    // write deploy function - same as previous except needs way more info and permissions 
    // to read and write to the s3 
    const deployFn = new lambda.Function(this, 'DeployIfGoodFn', {
      runtime: lambda.Runtime.PYTHON_3_9,
      code:    lambda.Code.fromAsset('lambda/deploy/'),
      handler: 'deploy_if_good_fn.handler',
      environment: {
        SM_ROLE_ARN:   sagemakerRole.roleArn,
        ENDPOINT_NAME: endpoint.attrEndpointName,
        INFERENCE_IMAGE:
          '763104351884.dkr.ecr.eu-north-1.amazonaws.com/pytorch-inference:2.0.0-cpu-py310-ubuntu20.04-sagemaker',
        ASSET_BUCKET: assetBucket.bucketName,
        OUTPUT_PREFIX: 'output/',   
        VPC_CONFIG: JSON.stringify({
          Subnets: vpc.privateSubnets.map(s => s.subnetId),
          SecurityGroupIds: [endpointSg.securityGroupId],
        }),
      },
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [endpointSg],
    });


    // deploy function permissions for endpoint
    deployFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'sagemaker:CreateModel',
        'sagemaker:CreateEndpointConfig',
        'sagemaker:UpdateEndpoint',
        'sagemaker:DescribeEndpoint',
      ],
      resources: ['*'],
    }));
    
    // permissions for writiing to bucket
    deployFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [ assetBucket.bucketArn ],
        conditions: {
           StringLike: { 's3:prefix': [ 'output/' ] }
        }
    }));


    // permissions for taking stuff from the bucket (images)
    deployFn.addToRolePolicy(new iam.PolicyStatement({
       actions: ['s3:GetObject'],
       resources: [ `${assetBucket.bucketArn}/output/` ],
    }));




     deployFn.addToRolePolicy(new iam.PolicyStatement({
       actions: ['iam:PassRole'],
       resources: [ sagemakerRole.roleArn ],
     }));






    new events.Rule(this, 'PipelineSuccessRule', {
      eventPattern: {
        source:     ['aws.sagemaker'],
        detailType: ['SageMaker Pipeline Execution Status Change'],
        detail: {
          pipelineName: ['CaptionModelPipeline'],
          pipelineExecutionStatus: ['Succeeded'],
        },
      },
      targets: [new targets.LambdaFunction(deployFn)],
    });
  }
}
