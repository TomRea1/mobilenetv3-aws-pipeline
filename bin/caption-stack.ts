#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CaptionStack } from '../lib/caption-stack-stack';

const app = new cdk.App();
new CaptionStack(app, 'CaptionStack', {
	env: {account : process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION},
});

