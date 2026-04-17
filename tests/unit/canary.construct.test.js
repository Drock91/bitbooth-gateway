import { describe, it, expect } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { HealthCanary } from '../../infra/stacks/constructs/canary.js';

function buildStack(stage = 'dev', { withAlarmTopic = true } = {}) {
  const app = new App();
  const stack = new Stack(app, `CanaryTest-${stage}-${Date.now()}`);

  const api = new RestApi(stack, 'TestApi', { restApiName: `test-api-${stage}` });
  api.root.addMethod('GET');
  const apiGw = { api };

  const alarmTopic = withAlarmTopic ? new Topic(stack, 'TestTopic') : undefined;

  const canary = new HealthCanary(stack, 'HealthCanary', { stage, apiGw, alarmTopic });
  const template = Template.fromStack(stack);

  return { stack, canary, template, apiGw };
}

describe('HealthCanary construct', () => {
  describe('Synthetics Canary resource', () => {
    it('creates exactly one Canary', () => {
      const { template } = buildStack();
      template.resourceCountIs('AWS::Synthetics::Canary', 1);
    });

    it('names the canary with the stage suffix', () => {
      const { template } = buildStack('staging');
      template.hasResourceProperties('AWS::Synthetics::Canary', {
        Name: 'x402-staging-health',
      });
    });

    it('uses dev stage in canary name', () => {
      const { template } = buildStack('dev');
      template.hasResourceProperties('AWS::Synthetics::Canary', {
        Name: 'x402-dev-health',
      });
    });

    it('uses prod stage in canary name', () => {
      const { template } = buildStack('prod');
      template.hasResourceProperties('AWS::Synthetics::Canary', {
        Name: 'x402-prod-health',
      });
    });

    it('uses Synthetics Node.js Puppeteer 9.1 runtime', () => {
      const { template } = buildStack();
      template.hasResourceProperties('AWS::Synthetics::Canary', {
        RuntimeVersion: 'syn-nodejs-puppeteer-9.1',
      });
    });

    it('uses inline code with index.handler', () => {
      const { template } = buildStack();
      template.hasResourceProperties('AWS::Synthetics::Canary', {
        Code: Match.objectLike({
          Handler: 'index.handler',
          Script: Match.anyValue(),
        }),
      });
    });

    it('inline code contains health check logic', () => {
      const { template } = buildStack();
      const canaries = template.findResources('AWS::Synthetics::Canary');
      const canaryKey = Object.keys(canaries)[0];
      const script = canaries[canaryKey].Properties.Code.Script;
      expect(script).toContain('Synthetics');
      expect(script).toContain('CANARY_TARGET_URL');
      expect(script).toContain('Health check passed');
    });

    it('sets 5-minute schedule in prod', () => {
      const { template } = buildStack('prod');
      template.hasResourceProperties('AWS::Synthetics::Canary', {
        Schedule: Match.objectLike({
          Expression: 'rate(5 minutes)',
        }),
      });
    });

    it('sets 15-minute schedule in dev', () => {
      const { template } = buildStack('dev');
      template.hasResourceProperties('AWS::Synthetics::Canary', {
        Schedule: Match.objectLike({
          Expression: 'rate(15 minutes)',
        }),
      });
    });

    it('sets 15-minute schedule in staging', () => {
      const { template } = buildStack('staging');
      template.hasResourceProperties('AWS::Synthetics::Canary', {
        Schedule: Match.objectLike({
          Expression: 'rate(15 minutes)',
        }),
      });
    });

    it('sets success retention to 7 days', () => {
      const { template } = buildStack();
      template.hasResourceProperties('AWS::Synthetics::Canary', {
        SuccessRetentionPeriod: 7,
      });
    });

    it('sets failure retention to 14 days', () => {
      const { template } = buildStack();
      template.hasResourceProperties('AWS::Synthetics::Canary', {
        FailureRetentionPeriod: 14,
      });
    });
  });

  describe('CloudWatch Alarm', () => {
    it('creates exactly one alarm', () => {
      const { template } = buildStack();
      template.resourceCountIs('AWS::CloudWatch::Alarm', 1);
    });

    it('names the alarm with stage suffix', () => {
      const { template } = buildStack('staging');
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'x402-staging-health-canary-failed',
      });
    });

    it('uses dev stage in alarm name', () => {
      const { template } = buildStack('dev');
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'x402-dev-health-canary-failed',
      });
    });

    it('uses prod stage in alarm name', () => {
      const { template } = buildStack('prod');
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'x402-prod-health-canary-failed',
      });
    });

    it('sets threshold to 100', () => {
      const { template } = buildStack();
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        Threshold: 100,
      });
    });

    it('evaluates over 2 periods', () => {
      const { template } = buildStack();
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        EvaluationPeriods: 2,
      });
    });

    it('uses LessThanThreshold comparison', () => {
      const { template } = buildStack();
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        ComparisonOperator: 'LessThanThreshold',
      });
    });

    it('treats missing data as breaching', () => {
      const { template } = buildStack();
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        TreatMissingData: 'breaching',
      });
    });

    it('uses 10-minute metric period', () => {
      const { template } = buildStack();
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        Period: 600,
      });
    });

    it('includes alarm description', () => {
      const { template } = buildStack();
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmDescription: 'Health canary success rate < 100% in 10 min',
      });
    });
  });

  describe('SNS alarm action', () => {
    it('wires SNS action when alarmTopic is provided', () => {
      const { template } = buildStack('dev', { withAlarmTopic: true });
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmActions: Match.anyValue(),
      });
    });

    it('SNS action references the topic ARN', () => {
      const { template } = buildStack('dev', { withAlarmTopic: true });
      const alarms = template.findResources('AWS::CloudWatch::Alarm');
      const alarmKey = Object.keys(alarms)[0];
      const actions = alarms[alarmKey].Properties.AlarmActions;
      expect(actions).toBeDefined();
      expect(actions.length).toBe(1);
    });

    it('does not wire alarm actions when alarmTopic is undefined', () => {
      const { template } = buildStack('dev', { withAlarmTopic: false });
      const alarms = template.findResources('AWS::CloudWatch::Alarm');
      const alarmKey = Object.keys(alarms)[0];
      const actions = alarms[alarmKey].Properties.AlarmActions;
      expect(actions).toBeUndefined();
    });
  });

  describe('construct properties', () => {
    it('exposes canary property', () => {
      const { canary } = buildStack();
      expect(canary.canary).toBeDefined();
    });

    it('canary has canaryName', () => {
      const { canary } = buildStack();
      expect(canary.canary.canaryName).toBeDefined();
    });
  });
});
