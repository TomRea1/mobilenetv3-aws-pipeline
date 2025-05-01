import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3  from 'aws-cdk-lib/aws-s3';
import * as sm  from 'aws-cdk-lib/aws-sagemaker';

export class CaptionStackStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

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

    vpc.addGatewayEndpoint('S3Gw', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
    });

    const assetBucket = s3.Bucket.fromBucketName(
      this,
      'ModelBucket',
      'cdk-hnb659fds-assets-564750642551-eu-north-1',
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
  }
}

