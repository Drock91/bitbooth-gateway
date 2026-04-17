#!/usr/bin/env node

/**
 * Provisions the x402-autopilot-deployer IAM role with minimal permissions
 * for CDK deploy in us-east-2 only.
 *
 * Usage:
 *   node scripts/ops/setup-autopilot-iam.js --account 123456789012 [--dry-run]
 *
 * Prerequisites:
 *   - AWS CLI v2 configured with admin credentials
 *   - CDK bootstrap already run in the target account/region
 */

import { execSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const REGION = 'us-east-2';
const CDK_QUALIFIER = 'hnb659fds';
const ROLE_NAME = 'x402-autopilot-deployer';
const POLICY_NAME = 'x402-autopilot-cdk-deploy';

const { values } = parseArgs({
  options: {
    account: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

if (!values.account) {
  console.error('Usage: node setup-autopilot-iam.js --account <ACCOUNT_ID> [--dry-run]');
  process.exit(1);
}

const acct = values.account;
const dryRun = values['dry-run'];

const trustPolicy = {
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Principal: { AWS: `arn:aws:iam::${acct}:root` },
      Action: 'sts:AssumeRole',
      Condition: {
        StringEquals: { 'aws:RequestedRegion': REGION },
      },
    },
  ],
};

const cdkRoles = [
  `arn:aws:iam::${acct}:role/cdk-${CDK_QUALIFIER}-deploy-role-${acct}-${REGION}`,
  `arn:aws:iam::${acct}:role/cdk-${CDK_QUALIFIER}-file-publishing-role-${acct}-${REGION}`,
  `arn:aws:iam::${acct}:role/cdk-${CDK_QUALIFIER}-lookup-role-${acct}-${REGION}`,
  `arn:aws:iam::${acct}:role/cdk-${CDK_QUALIFIER}-image-publishing-role-${acct}-${REGION}`,
];

const deployPolicy = {
  Version: '2012-10-17',
  Statement: [
    {
      Sid: 'AssumeCdkBootstrapRoles',
      Effect: 'Allow',
      Action: 'sts:AssumeRole',
      Resource: cdkRoles,
    },
    {
      Sid: 'ReadStackStatus',
      Effect: 'Allow',
      Action: ['cloudformation:DescribeStacks', 'cloudformation:GetTemplate'],
      Resource: `arn:aws:cloudformation:${REGION}:${acct}:stack/X402-*/*`,
    },
  ],
};

function run(cmd) {
  if (dryRun) {
    console.log(`[dry-run] ${cmd}`);
    return '';
  }
  return execSync(cmd, { encoding: 'utf-8' }).trim();
}

console.log(`\n=== x402 Autopilot IAM Setup ===`);
console.log(`Account:  ${acct}`);
console.log(`Region:   ${REGION}`);
console.log(`Role:     ${ROLE_NAME}`);
console.log(`Dry-run:  ${dryRun}\n`);

console.log('--- Trust Policy ---');
console.log(JSON.stringify(trustPolicy, null, 2));
console.log('\n--- Deploy Policy ---');
console.log(JSON.stringify(deployPolicy, null, 2));

console.log('\n1. Creating IAM role...');
run(
  `aws iam create-role --role-name ${ROLE_NAME} ` +
    `--assume-role-policy-document '${JSON.stringify(trustPolicy)}' ` +
    `--description "Scoped CDK deploy role for x402 autopilot container" ` +
    `--tags Key=Service,Value=x402 Key=ManagedBy,Value=autopilot`,
);

console.log('2. Creating inline policy...');
run(
  `aws iam put-role-policy --role-name ${ROLE_NAME} ` +
    `--policy-name ${POLICY_NAME} ` +
    `--policy-document '${JSON.stringify(deployPolicy)}'`,
);

console.log('3. Creating access key for container...');
if (!dryRun) {
  const keyJson = run(`aws iam create-access-key --user-name ${ROLE_NAME} 2>/dev/null || echo ""`);
  if (keyJson) {
    const key = JSON.parse(keyJson);
    console.log('\n=== Add to .env (never commit) ===');
    console.log(`AWS_ACCESS_KEY_ID=${key.AccessKey.AccessKeyId}`);
    console.log(`AWS_SECRET_ACCESS_KEY=${key.AccessKey.SecretAccessKey}`);
    console.log(`AWS_DEFAULT_REGION=${REGION}`);
    console.log(`CDK_DEFAULT_ACCOUNT=${acct}`);
    console.log(`CDK_DEFAULT_REGION=${REGION}`);
  } else {
    console.log('   (Using role-based auth — no IAM user keys needed)');
    console.log('\n=== Add to .env (never commit) ===');
    console.log(`AWS_ROLE_ARN=arn:aws:iam::${acct}:role/${ROLE_NAME}`);
    console.log(`AWS_DEFAULT_REGION=${REGION}`);
    console.log(`CDK_DEFAULT_ACCOUNT=${acct}`);
    console.log(`CDK_DEFAULT_REGION=${REGION}`);
  }
} else {
  console.log('\n=== Add to .env (never commit) ===');
  console.log(`AWS_ROLE_ARN=arn:aws:iam::${acct}:role/${ROLE_NAME}`);
  console.log(`AWS_DEFAULT_REGION=${REGION}`);
  console.log(`CDK_DEFAULT_ACCOUNT=${acct}`);
  console.log(`CDK_DEFAULT_REGION=${REGION}`);
}

console.log(`\nSTAGE=staging`);

console.log('\n=== CDK Bootstrap Roles Assumed ===');
cdkRoles.forEach((r) => console.log(`  ${r}`));

console.log('\n=== What this role CANNOT do ===');
console.log('  - Access any region other than us-east-2');
console.log('  - Modify IAM policies or users');
console.log('  - Access Secrets Manager directly (only via CDK cfn-exec role)');
console.log('  - Delete stacks (only deploy/update)');
console.log('  - Access any non-x402 resources');

console.log('\nDone.');
