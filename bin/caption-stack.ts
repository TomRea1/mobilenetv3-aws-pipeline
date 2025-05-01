#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CaptionStackStack } from '../lib/caption-stack-stack';

const app = new cdk.App();
new CaptionStackStack(app, 'CaptionStackStack', {});
