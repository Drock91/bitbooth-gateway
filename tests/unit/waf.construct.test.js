import { describe, it, expect } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { Waf } from '../../infra/stacks/constructs/waf.js';

function buildStack(stage = 'dev') {
  const app = new App();
  const stack = new Stack(app, `WafTest-${stage}-${Date.now()}`);

  const api = new RestApi(stack, 'TestApi', { restApiName: `test-api-${stage}` });
  api.root.addMethod('GET');
  const apiGw = { api };

  const waf = new Waf(stack, 'Waf', { stage, apiGw });
  const template = Template.fromStack(stack);

  return { stack, waf, template, apiGw };
}

describe('Waf construct', () => {
  describe('WebACL resource', () => {
    it('creates exactly one WebACL', () => {
      const { template } = buildStack();
      template.resourceCountIs('AWS::WAFv2::WebACL', 1);
    });

    it('names the WebACL with the stage suffix', () => {
      const { template } = buildStack('staging');
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        Name: 'x402-waf-staging',
      });
    });

    it('uses REGIONAL scope', () => {
      const { template } = buildStack();
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        Scope: 'REGIONAL',
      });
    });

    it('sets default action to allow', () => {
      const { template } = buildStack();
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        DefaultAction: { Allow: {} },
      });
    });

    it('enables CloudWatch metrics on the WebACL', () => {
      const { template } = buildStack('prod');
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        VisibilityConfig: Match.objectLike({
          CloudWatchMetricsEnabled: true,
          MetricName: 'x402-waf-prod',
          SampledRequestsEnabled: true,
        }),
      });
    });
  });

  describe('managed rule groups', () => {
    it('includes exactly 2 rules', () => {
      const { template } = buildStack();
      const webAcls = template.findResources('AWS::WAFv2::WebACL');
      const webAclKey = Object.keys(webAcls)[0];
      expect(webAcls[webAclKey].Properties.Rules).toHaveLength(2);
    });

    it('includes AWSManagedRulesCommonRuleSet at priority 1', () => {
      const { template } = buildStack();
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        Rules: Match.arrayWith([
          Match.objectLike({
            Name: 'AWSManagedRulesCommonRuleSet',
            Priority: 1,
            OverrideAction: { None: {} },
            Statement: {
              ManagedRuleGroupStatement: {
                VendorName: 'AWS',
                Name: 'AWSManagedRulesCommonRuleSet',
              },
            },
          }),
        ]),
      });
    });

    it('includes AWSManagedRulesKnownBadInputsRuleSet at priority 2', () => {
      const { template } = buildStack();
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        Rules: Match.arrayWith([
          Match.objectLike({
            Name: 'AWSManagedRulesKnownBadInputsRuleSet',
            Priority: 2,
            OverrideAction: { None: {} },
            Statement: {
              ManagedRuleGroupStatement: {
                VendorName: 'AWS',
                Name: 'AWSManagedRulesKnownBadInputsRuleSet',
              },
            },
          }),
        ]),
      });
    });

    it('enables CloudWatch metrics on CommonRuleSet with stage suffix', () => {
      const { template } = buildStack('staging');
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        Rules: Match.arrayWith([
          Match.objectLike({
            Name: 'AWSManagedRulesCommonRuleSet',
            VisibilityConfig: {
              CloudWatchMetricsEnabled: true,
              MetricName: 'x402-waf-common-staging',
              SampledRequestsEnabled: true,
            },
          }),
        ]),
      });
    });

    it('enables CloudWatch metrics on KnownBadInputsRuleSet with stage suffix', () => {
      const { template } = buildStack('prod');
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        Rules: Match.arrayWith([
          Match.objectLike({
            Name: 'AWSManagedRulesKnownBadInputsRuleSet',
            VisibilityConfig: {
              CloudWatchMetricsEnabled: true,
              MetricName: 'x402-waf-bad-inputs-prod',
              SampledRequestsEnabled: true,
            },
          }),
        ]),
      });
    });

    it('uses override action none (not block) for both rules', () => {
      const { template } = buildStack();
      const webAcls = template.findResources('AWS::WAFv2::WebACL');
      const webAclKey = Object.keys(webAcls)[0];
      const rules = webAcls[webAclKey].Properties.Rules;
      for (const rule of rules) {
        expect(rule.OverrideAction).toEqual({ None: {} });
      }
    });

    it('uses AWS as vendor for both managed rule groups', () => {
      const { template } = buildStack();
      const webAcls = template.findResources('AWS::WAFv2::WebACL');
      const webAclKey = Object.keys(webAcls)[0];
      const rules = webAcls[webAclKey].Properties.Rules;
      for (const rule of rules) {
        expect(rule.Statement.ManagedRuleGroupStatement.VendorName).toBe('AWS');
      }
    });

    it('assigns sequential priorities starting from 1', () => {
      const { template } = buildStack();
      const webAcls = template.findResources('AWS::WAFv2::WebACL');
      const webAclKey = Object.keys(webAcls)[0];
      const priorities = webAcls[webAclKey].Properties.Rules.map((r) => r.Priority);
      expect(priorities).toEqual([1, 2]);
    });
  });

  describe('WebACL association', () => {
    it('creates exactly one WebACL association', () => {
      const { template } = buildStack();
      template.resourceCountIs('AWS::WAFv2::WebACLAssociation', 1);
    });

    it('associates the WebACL with the API Gateway stage', () => {
      const { template } = buildStack();
      template.hasResourceProperties('AWS::WAFv2::WebACLAssociation', {
        ResourceArn: Match.anyValue(),
        WebACLArn: Match.anyValue(),
      });
    });

    it('references the WebACL ARN via GetAtt', () => {
      const { template } = buildStack();
      const assocs = template.findResources('AWS::WAFv2::WebACLAssociation');
      const assocKey = Object.keys(assocs)[0];
      const webAclArn = assocs[assocKey].Properties.WebACLArn;
      expect(webAclArn).toHaveProperty('Fn::GetAtt');
      expect(webAclArn['Fn::GetAtt'][1]).toBe('Arn');
    });
  });

  describe('stage parameterization', () => {
    it('uses dev stage name in WebACL name', () => {
      const { template } = buildStack('dev');
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        Name: 'x402-waf-dev',
      });
    });

    it('uses prod stage name in WebACL name', () => {
      const { template } = buildStack('prod');
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        Name: 'x402-waf-prod',
      });
    });

    it('uses prod stage name in all metric names', () => {
      const { template } = buildStack('prod');
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        VisibilityConfig: Match.objectLike({
          MetricName: 'x402-waf-prod',
        }),
        Rules: Match.arrayWith([
          Match.objectLike({
            VisibilityConfig: Match.objectLike({
              MetricName: 'x402-waf-common-prod',
            }),
          }),
          Match.objectLike({
            VisibilityConfig: Match.objectLike({
              MetricName: 'x402-waf-bad-inputs-prod',
            }),
          }),
        ]),
      });
    });
  });

  describe('construct properties', () => {
    it('exposes webAcl property', () => {
      const { waf } = buildStack();
      expect(waf.webAcl).toBeDefined();
    });

    it('webAcl has attrArn', () => {
      const { waf } = buildStack();
      expect(waf.webAcl.attrArn).toBeDefined();
    });
  });
});
