#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { X402Stack } from './stacks/x402.stack.js';

const app = new App();
const stage = process.env.STAGE ?? 'dev';

new X402Stack(app, `X402-${stage}`, {
  stage,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
});
