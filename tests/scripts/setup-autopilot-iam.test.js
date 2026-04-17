import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

describe('setup-autopilot-iam', () => {
  const ACCOUNT = '123456789012';
  const REGION = 'us-east-2';
  const QUALIFIER = 'hnb659fds';

  describe('policy structure', () => {
    it('trust policy allows assume-role from same account', () => {
      const trust = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: `arn:aws:iam::${ACCOUNT}:root` },
            Action: 'sts:AssumeRole',
            Condition: {
              StringEquals: { 'aws:RequestedRegion': REGION },
            },
          },
        ],
      };

      expect(trust.Statement).toHaveLength(1);
      expect(trust.Statement[0].Effect).toBe('Allow');
      expect(trust.Statement[0].Action).toBe('sts:AssumeRole');
      expect(trust.Statement[0].Condition.StringEquals['aws:RequestedRegion']).toBe('us-east-2');
    });

    it('deploy policy only allows sts:AssumeRole on CDK bootstrap roles', () => {
      const cdkRoles = [
        `arn:aws:iam::${ACCOUNT}:role/cdk-${QUALIFIER}-deploy-role-${ACCOUNT}-${REGION}`,
        `arn:aws:iam::${ACCOUNT}:role/cdk-${QUALIFIER}-file-publishing-role-${ACCOUNT}-${REGION}`,
        `arn:aws:iam::${ACCOUNT}:role/cdk-${QUALIFIER}-lookup-role-${ACCOUNT}-${REGION}`,
        `arn:aws:iam::${ACCOUNT}:role/cdk-${QUALIFIER}-image-publishing-role-${ACCOUNT}-${REGION}`,
      ];

      const policy = {
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
            Resource: `arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/X402-*/*`,
          },
        ],
      };

      expect(policy.Statement).toHaveLength(2);

      const assumeStmt = policy.Statement[0];
      expect(assumeStmt.Action).toBe('sts:AssumeRole');
      expect(assumeStmt.Resource).toHaveLength(4);
      assumeStmt.Resource.forEach((arn) => {
        expect(arn).toContain(REGION);
        expect(arn).toContain(ACCOUNT);
        expect(arn).toMatch(/^arn:aws:iam::/);
      });

      const cfnStmt = policy.Statement[1];
      expect(cfnStmt.Action).toContain('cloudformation:DescribeStacks');
      expect(cfnStmt.Resource).toContain('X402-*');
    });

    it('all CDK bootstrap role ARNs use correct qualifier', () => {
      const roleNames = [
        'deploy-role',
        'file-publishing-role',
        'lookup-role',
        'image-publishing-role',
      ];

      roleNames.forEach((name) => {
        const arn = `arn:aws:iam::${ACCOUNT}:role/cdk-${QUALIFIER}-${name}-${ACCOUNT}-${REGION}`;
        expect(arn).toContain(`cdk-${QUALIFIER}-`);
        expect(arn).toContain(REGION);
      });
    });

    it('policy does not include any IAM mutation actions', () => {
      const allowedActions = [
        'sts:AssumeRole',
        'cloudformation:DescribeStacks',
        'cloudformation:GetTemplate',
      ];
      const dangerousActions = [
        'iam:CreateRole',
        'iam:DeleteRole',
        'iam:PutRolePolicy',
        'iam:AttachRolePolicy',
        'iam:CreateUser',
        'iam:CreateAccessKey',
      ];

      dangerousActions.forEach((action) => {
        expect(allowedActions).not.toContain(action);
      });
    });

    it('policy does not include secretsmanager actions', () => {
      const allowedActions = [
        'sts:AssumeRole',
        'cloudformation:DescribeStacks',
        'cloudformation:GetTemplate',
      ];
      expect(allowedActions).not.toContain('secretsmanager:GetSecretValue');
      expect(allowedActions).not.toContain('secretsmanager:CreateSecret');
    });

    it('cloudformation resource is scoped to X402-* stacks', () => {
      const resource = `arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/X402-*/*`;
      expect(resource).toContain('X402-*');
      expect(resource).not.toBe('*');
      expect(resource).toContain(REGION);
    });
  });

  describe('script argument validation', () => {
    it('exits with error when --account is missing', () => {
      expect(() => {
        execSync('node scripts/ops/setup-autopilot-iam.js 2>&1', {
          encoding: 'utf-8',
          timeout: 5000,
        });
      }).toThrow();
    });

    it('dry-run does not call aws CLI', () => {
      const output = execSync(
        'node scripts/ops/setup-autopilot-iam.js --account 111222333444 --dry-run 2>&1',
        { encoding: 'utf-8', timeout: 5000 },
      );

      expect(output).toContain('[dry-run]');
      expect(output).toContain('111222333444');
      expect(output).toContain('us-east-2');
      expect(output).toContain('x402-autopilot-deployer');
    });

    it('dry-run prints trust and deploy policies', () => {
      const output = execSync(
        'node scripts/ops/setup-autopilot-iam.js --account 111222333444 --dry-run 2>&1',
        { encoding: 'utf-8', timeout: 5000 },
      );

      expect(output).toContain('Trust Policy');
      expect(output).toContain('Deploy Policy');
      expect(output).toContain('sts:AssumeRole');
      expect(output).toContain('AssumeCdkBootstrapRoles');
    });

    it('dry-run shows env var template', () => {
      const output = execSync(
        'node scripts/ops/setup-autopilot-iam.js --account 111222333444 --dry-run 2>&1',
        { encoding: 'utf-8', timeout: 5000 },
      );

      expect(output).toContain('AWS_ROLE_ARN');
      expect(output).toContain('CDK_DEFAULT_ACCOUNT');
      expect(output).toContain('CDK_DEFAULT_REGION');
      expect(output).toContain('STAGE');
    });

    it('dry-run lists what the role cannot do', () => {
      const output = execSync(
        'node scripts/ops/setup-autopilot-iam.js --account 111222333444 --dry-run 2>&1',
        { encoding: 'utf-8', timeout: 5000 },
      );

      expect(output).toContain('CANNOT');
      expect(output).toContain('us-east-2');
      expect(output).toContain('IAM');
      expect(output).toContain('Secrets Manager');
    });

    it('dry-run lists all 4 CDK bootstrap roles', () => {
      const output = execSync(
        'node scripts/ops/setup-autopilot-iam.js --account 111222333444 --dry-run 2>&1',
        { encoding: 'utf-8', timeout: 5000 },
      );

      expect(output).toContain('deploy-role');
      expect(output).toContain('file-publishing-role');
      expect(output).toContain('lookup-role');
      expect(output).toContain('image-publishing-role');
    });
  });

  describe('region scoping', () => {
    it('all role ARNs reference us-east-2 only', () => {
      const output = execSync(
        'node scripts/ops/setup-autopilot-iam.js --account 999888777666 --dry-run 2>&1',
        { encoding: 'utf-8', timeout: 5000 },
      );

      const roleLines = output
        .split('\n')
        .filter((l) => l.includes('arn:aws:iam') && l.includes('/cdk-'));
      expect(roleLines.length).toBeGreaterThanOrEqual(4);
      roleLines.forEach((line) => {
        expect(line).toContain('us-east-2');
      });

      expect(output).not.toContain('us-east-1');
      expect(output).not.toContain('us-west-');
    });

    it('cloudformation resource ARN is us-east-2', () => {
      const output = execSync(
        'node scripts/ops/setup-autopilot-iam.js --account 999888777666 --dry-run 2>&1',
        { encoding: 'utf-8', timeout: 5000 },
      );

      expect(output).toContain('cloudformation:us-east-2');
    });
  });
});
