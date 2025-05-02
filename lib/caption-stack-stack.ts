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

    
    const vpc = new ec2.Vpc(this, 'CaptionVpc', {
      maxAzs: 2,
      natGateways: 2,
      subnetConfiguration: [
        { name: 'public',  subnetType: ec2.SubnetType.PUBLIC,              cidrMask: 24 },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
      restrictDefaultSecurityGroup: false,
    });

    vpc.addGatewayEndpoint('S3Gw', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
    });

    
    const ingestBucket = new s3.Bucket(this, 'IngestBucket', {
      removalPolicy: RemovalPolicy.DESTROY,   // dev-only
      autoDeleteObjects: true,
    });

    
    const assetBucket = s3.Bucket.fromBucketName(
      this, 'ModelBucket', 'cdk-hnb659fds-assets-564750642551-eu-north-1',
    );

    
    const sagemakerRole = new iam.Role(this, 'SageMakerExecRole', {
      assumedBy: new iam.ServicePrincipal('sagemaker.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3ReadOnlyAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'),
      ],
    });

    const endpointSg = new ec2.SecurityGroup(this, 'SmEndpointSG', {
      vpc,
      description: 'Allow HTTPS from VPC to SageMaker endpoint',
      allowAllOutbound: true,
    });

    
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

    const endpoint = new sm.CfnEndpoint(this, 'CaptionEndpoint', {
      endpointConfigName: endpointConfig.attrEndpointConfigName,
    });

    endpointConfig.addDependency(model);
    endpoint.addDependency(endpointConfig);

    // Lambdas 
    const triggerFn = new lambda.Function(this, 'TriggerPipelineFn', {
      runtime: lambda.Runtime.PYTHON_3_9,
      code:    lambda.Code.fromAsset('lambda/trigger'),
      handler: 'trigger_pipeline_fn.handler',
      environment: { PIPELINE_NAME: 'CaptionModelPipeline' },
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [endpointSg],
    });

    ingestBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED_PUT,
      new s3n.LambdaDestination(triggerFn),
      { prefix: 'train-images/' },
    );

    triggerFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['sagemaker:StartPipelineExecution'],
      resources: ['*'],
    }));

    
    const deployFn = new lambda.Function(this, 'DeployOnSuccessFn', {
      runtime: lambda.Runtime.PYTHON_3_9,
      code:    lambda.Code.fromAsset('lambda/deploy'),
      handler: 'deploy_on_success_fn.handler',
      environment: {
        SM_ROLE_ARN:   sagemakerRole.roleArn,
        ENDPOINT_NAME: endpoint.ref,
        INFERENCE_IMAGE:
          '763104351884.dkr.ecr.eu-north-1.amazonaws.com/pytorch-inference:2.0.0-cpu-py310-ubuntu20.04-sagemaker',
        VPC_CONFIG: JSON.stringify({
          Subnets: vpc.privateSubnets.map(s => s.subnetId),
          SecurityGroupIds: [endpointSg.securityGroupId],
        }),
      },
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [endpointSg],
    });

    deployFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'sagemaker:CreateModel',
        'sagemaker:CreateEndpointConfig',
        'sagemaker:UpdateEndpoint',
        'sagemaker:DescribeEndpoint',
      ],
      resources: ['*'],
    }));

    new events.Rule(this, 'PipelineSuccessRule', {
      eventPattern: {
        source:     ['aws.sagemaker'],
        detailType: ['SageMaker Model Building Pipeline Execution Status Change'],
        detail: {
          pipelineName: ['CaptionModelPipeline'],
          currentPipelineExecutionStatus: ['Succeeded'],
        },
      },
      targets: [new targets.LambdaFunction(deployFn)],
    });
  }
}