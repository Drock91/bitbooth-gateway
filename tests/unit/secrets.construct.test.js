import { describe, it, expect } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Secrets } from '../../infra/stacks/constructs/secrets.js';

function buildStack(stage = 'dev') {
  const app = new App();
  const stack = new Stack(app, `SecretsTest-${stage}-${Date.now()}`);
  const secrets = new Secrets(stack, 'Secrets', { stage });
  const template = Template.fromStack(stack);
  return { stack, secrets, template };
}

const ALL_SECRETS = [
  {
    prop: 'agentWallet',
    name: 'agent-wallet',
    desc: 'Agent wallet private key for Base USDC micropayments',
  },
  {
    prop: 'stripeWebhook',
    name: 'stripe-webhook',
    desc: 'Stripe webhook signing secret (whsec_…)',
  },
  { prop: 'baseRpc', name: 'base-rpc', desc: 'Base mainnet RPC URL (may contain API key)' },
  {
    prop: 'adminApiKeyHash',
    name: 'admin-api-key-hash',
    desc: 'SHA-256 hash of the admin API key for /admin endpoints',
  },
];

describe('Secrets construct', () => {
  describe('resource count', () => {
    it('creates exactly 4 Secret resources', () => {
      const { template } = buildStack();
      template.resourceCountIs('AWS::SecretsManager::Secret', 4);
    });
  });

  describe('secretName per stage', () => {
    for (const { prop, name } of ALL_SECRETS) {
      it(`${prop} has correct secretName for dev stage`, () => {
        const { template } = buildStack('dev');
        template.hasResourceProperties('AWS::SecretsManager::Secret', {
          Name: `x402/dev/${name}`,
        });
      });
    }

    it('uses staging prefix for staging stage', () => {
      const { template } = buildStack('staging');
      template.hasResourceProperties('AWS::SecretsManager::Secret', {
        Name: 'x402/staging/agent-wallet',
      });
    });

    it('uses prod prefix for prod stage', () => {
      const { template } = buildStack('prod');
      template.hasResourceProperties('AWS::SecretsManager::Secret', {
        Name: 'x402/prod/agent-wallet',
      });
    });

    it('exchange secrets include stage in name for prod', () => {
      const { template } = buildStack('prod');
      for (const { name } of ALL_SECRETS.filter((s) => s.name.startsWith('exchanges/'))) {
        template.hasResourceProperties('AWS::SecretsManager::Secret', {
          Name: `x402/prod/${name}`,
        });
      }
    });
  });

  describe('descriptions', () => {
    for (const { prop, desc } of ALL_SECRETS) {
      it(`${prop} has the expected description`, () => {
        const { template } = buildStack();
        template.hasResourceProperties('AWS::SecretsManager::Secret', {
          Description: desc,
        });
      });
    }
  });

  describe('instance properties', () => {
    for (const { prop } of ALL_SECRETS) {
      it(`exposes ${prop} as a construct property`, () => {
        const { secrets } = buildStack();
        expect(secrets[prop]).toBeDefined();
        expect(secrets[prop].secretArn).toBeDefined();
      });
    }
  });

  describe('stage isolation', () => {
    it('dev and prod create secrets with different names', () => {
      const { template: devTpl } = buildStack('dev');
      const { template: prodTpl } = buildStack('prod');

      const devSecrets = devTpl.findResources('AWS::SecretsManager::Secret');
      const prodSecrets = prodTpl.findResources('AWS::SecretsManager::Secret');

      const devNames = Object.values(devSecrets).map((r) => r.Properties.Name);
      const prodNames = Object.values(prodSecrets).map((r) => r.Properties.Name);

      expect(devNames.every((n) => n.includes('/dev/'))).toBe(true);
      expect(prodNames.every((n) => n.includes('/prod/'))).toBe(true);
      expect(devNames).not.toEqual(prodNames);
    });
  });
});
