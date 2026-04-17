import { describe, it, expect } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Table, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { OpsDashboard } from '../../infra/stacks/constructs/dashboard.js';

function mkTable(stack, name) {
  return new Table(stack, name, {
    partitionKey: { name: 'pk', type: AttributeType.STRING },
    tableName: `test-${name}`,
  });
}

function mkFn(stack, name) {
  return new Function(stack, name, {
    functionName: `test-${name}`,
    runtime: Runtime.NODEJS_20_X,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = async () => {}'),
  });
}

function buildStack(stage = 'dev') {
  const app = new App();
  const stack = new Stack(app, `DashboardTest-${stage}-${Date.now()}`);

  const tables = {
    all: [
      ['Payments', mkTable(stack, 'Payments')],
      ['Tenants', mkTable(stack, 'Tenants')],
      ['Routes', mkTable(stack, 'Routes')],
    ],
  };

  const apiFn = mkFn(stack, 'Api');
  const webhookFn = mkFn(stack, 'Webhook');

  const lambdas = {
    allFns: [
      ['Api', apiFn],
      ['Webhook', webhookFn],
    ],
  };

  const api = new RestApi(stack, 'TestApi', { restApiName: 'test-api' });
  api.root.addMethod('GET');
  const apiGw = { api };

  const dash = new OpsDashboard(stack, 'OpsDashboard', {
    stage,
    lambdas,
    tables,
    apiGw,
  });
  const template = Template.fromStack(stack);

  return { stack, dash, template };
}

function getDashboardBody(template) {
  const dashboards = template.findResources('AWS::CloudWatch::Dashboard');
  const key = Object.keys(dashboards)[0];
  const bodyStr = dashboards[key].Properties.DashboardBody;
  return JSON.parse(JSON.stringify(bodyStr));
}

function resolveWidgets(template) {
  const body = getDashboardBody(template);
  if (body['Fn::Join']) {
    const parts = body['Fn::Join'][1];
    const raw = parts.map((p) => (typeof p === 'string' ? p : 'placeholder')).join('');
    return JSON.parse(raw).widgets;
  }
  if (typeof body === 'string') {
    return JSON.parse(body).widgets;
  }
  return null;
}

describe('OpsDashboard construct', () => {
  describe('Dashboard resource', () => {
    it('creates exactly one dashboard', () => {
      const { template } = buildStack();
      template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
    });

    it('names the dashboard x402-dev for dev stage', () => {
      const { template } = buildStack('dev');
      template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
        DashboardName: 'x402-dev',
      });
    });

    it('names the dashboard x402-staging for staging stage', () => {
      const { template } = buildStack('staging');
      template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
        DashboardName: 'x402-staging',
      });
    });

    it('names the dashboard x402-prod for prod stage', () => {
      const { template } = buildStack('prod');
      template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
        DashboardName: 'x402-prod',
      });
    });

    it('has a DashboardBody property', () => {
      const { template } = buildStack();
      const dashboards = template.findResources('AWS::CloudWatch::Dashboard');
      const key = Object.keys(dashboards)[0];
      expect(dashboards[key].Properties.DashboardBody).toBeDefined();
    });
  });

  describe('construct properties', () => {
    it('exposes dashboard property', () => {
      const { dash } = buildStack();
      expect(dash.dashboard).toBeDefined();
    });

    it('dashboard has dashboardName', () => {
      const { dash } = buildStack();
      expect(dash.dashboard.dashboardName).toBeDefined();
    });
  });

  describe('widget configuration', () => {
    it('contains 8 widgets in the dashboard body', () => {
      const widgets = resolveWidgets(buildStack().template);
      expect(widgets).not.toBeNull();
      expect(widgets.length).toBe(8);
    });

    it('first widget is Lambda Errors with type metric', () => {
      const widgets = resolveWidgets(buildStack().template);
      expect(widgets[0].type).toBe('metric');
      expect(widgets[0].properties.title).toBe('Lambda Errors');
    });

    it('Lambda Errors widget has width 12 and height 6', () => {
      const widgets = resolveWidgets(buildStack().template);
      expect(widgets[0].width).toBe(12);
      expect(widgets[0].height).toBe(6);
    });

    it('second widget is Lambda Invocations', () => {
      const widgets = resolveWidgets(buildStack().template);
      expect(widgets[1].type).toBe('metric');
      expect(widgets[1].properties.title).toBe('Lambda Invocations');
    });

    it('Lambda Invocations widget has width 12 and height 6', () => {
      const widgets = resolveWidgets(buildStack().template);
      expect(widgets[1].width).toBe(12);
      expect(widgets[1].height).toBe(6);
    });

    it('third widget is Lambda Duration P99', () => {
      const widgets = resolveWidgets(buildStack().template);
      expect(widgets[2].type).toBe('metric');
      expect(widgets[2].properties.title).toBe('Lambda Duration P99');
    });

    it('Lambda Duration P99 widget has width 12 and height 6', () => {
      const widgets = resolveWidgets(buildStack().template);
      expect(widgets[2].width).toBe(12);
      expect(widgets[2].height).toBe(6);
    });

    it('fourth widget is API Gateway Latency', () => {
      const widgets = resolveWidgets(buildStack().template);
      expect(widgets[3].type).toBe('metric');
      expect(widgets[3].properties.title).toBe('API Gateway Latency');
    });

    it('API Gateway Latency widget has width 12 and height 6', () => {
      const widgets = resolveWidgets(buildStack().template);
      expect(widgets[3].width).toBe(12);
      expect(widgets[3].height).toBe(6);
    });

    it('fifth widget is API Gateway Requests', () => {
      const widgets = resolveWidgets(buildStack().template);
      expect(widgets[4].type).toBe('metric');
      expect(widgets[4].properties.title).toBe('API Gateway Requests');
    });

    it('API Gateway Requests widget has width 12 and height 6', () => {
      const widgets = resolveWidgets(buildStack().template);
      expect(widgets[4].width).toBe(12);
      expect(widgets[4].height).toBe(6);
    });

    it('sixth widget is DDB Throttled Requests', () => {
      const widgets = resolveWidgets(buildStack().template);
      expect(widgets[5].type).toBe('metric');
      expect(widgets[5].properties.title).toBe('DDB Throttled Requests');
    });

    it('DDB Throttled Requests widget has width 12 and height 6', () => {
      const widgets = resolveWidgets(buildStack().template);
      expect(widgets[5].width).toBe(12);
      expect(widgets[5].height).toBe(6);
    });

    it('seventh widget is Payment Counts', () => {
      const widgets = resolveWidgets(buildStack().template);
      expect(widgets[6].type).toBe('metric');
      expect(widgets[6].properties.title).toBe('Payment Counts');
    });

    it('Payment Counts widget has width 12 and height 6', () => {
      const widgets = resolveWidgets(buildStack().template);
      expect(widgets[6].width).toBe(12);
      expect(widgets[6].height).toBe(6);
    });

    it('eighth widget is Summary', () => {
      const widgets = resolveWidgets(buildStack().template);
      expect(widgets[7].type).toBe('metric');
      expect(widgets[7].properties.title).toBe('Summary');
    });

    it('Summary widget has width 24 and height 3', () => {
      const widgets = resolveWidgets(buildStack().template);
      expect(widgets[7].width).toBe(24);
      expect(widgets[7].height).toBe(3);
    });
  });

  describe('Lambda metric widgets', () => {
    it('Lambda Errors widget includes metrics for each function', () => {
      const widgets = resolveWidgets(buildStack().template);
      const metrics = widgets[0].properties.metrics;
      expect(metrics.length).toBe(2);
    });

    it('Lambda Errors metrics use Errors metric name', () => {
      const widgets = resolveWidgets(buildStack().template);
      const metrics = widgets[0].properties.metrics;
      const hasErrors = metrics.every((m) => m.some((v) => v === 'Errors'));
      expect(hasErrors).toBe(true);
    });

    it('Lambda Errors metrics use Sum statistic', () => {
      const widgets = resolveWidgets(buildStack().template);
      const metrics = widgets[0].properties.metrics;
      const allSum = metrics.every((m) => {
        const opts = m.find((v) => typeof v === 'object' && v.stat);
        return opts && opts.stat === 'Sum';
      });
      expect(allSum).toBe(true);
    });

    it('Lambda Invocations metrics use Invocations metric name', () => {
      const widgets = resolveWidgets(buildStack().template);
      const metrics = widgets[1].properties.metrics;
      const hasInvocations = metrics.every((m) => m.some((v) => v === 'Invocations'));
      expect(hasInvocations).toBe(true);
    });

    it('Lambda Duration P99 metrics use Duration metric name', () => {
      const widgets = resolveWidgets(buildStack().template);
      const metrics = widgets[2].properties.metrics;
      const hasDuration = metrics.every((m) => m.some((v) => v === 'Duration'));
      expect(hasDuration).toBe(true);
    });

    it('Lambda Duration P99 metrics use p99 statistic', () => {
      const widgets = resolveWidgets(buildStack().template);
      const metrics = widgets[2].properties.metrics;
      const allP99 = metrics.every((m) => {
        const opts = m.find((v) => typeof v === 'object' && v.stat);
        return opts && opts.stat === 'p99';
      });
      expect(allP99).toBe(true);
    });

    it('Lambda Errors metrics use AWS/Lambda namespace', () => {
      const widgets = resolveWidgets(buildStack().template);
      const metrics = widgets[0].properties.metrics;
      const allLambda = metrics.every((m) => m[0] === 'AWS/Lambda');
      expect(allLambda).toBe(true);
    });
  });

  describe('API Gateway widgets', () => {
    it('API Gateway Latency has 3 metrics (p50, p90, p99)', () => {
      const widgets = resolveWidgets(buildStack().template);
      const metrics = widgets[3].properties.metrics;
      expect(metrics.length).toBe(3);
    });

    it('API Gateway Latency metrics use Latency metric name', () => {
      const widgets = resolveWidgets(buildStack().template);
      const metrics = widgets[3].properties.metrics;
      const allLatency = metrics.every((m) => m.some((v) => v === 'Latency'));
      expect(allLatency).toBe(true);
    });

    it('API Gateway Requests has 3 metrics (Total, 4xx, 5xx)', () => {
      const widgets = resolveWidgets(buildStack().template);
      const metrics = widgets[4].properties.metrics;
      expect(metrics.length).toBe(3);
    });

    it('API Gateway Requests includes Count metric', () => {
      const widgets = resolveWidgets(buildStack().template);
      const metrics = widgets[4].properties.metrics;
      const hasCount = metrics.some((m) => m.some((v) => v === 'Count'));
      expect(hasCount).toBe(true);
    });

    it('API Gateway Requests includes 4XXError metric', () => {
      const widgets = resolveWidgets(buildStack().template);
      const metrics = widgets[4].properties.metrics;
      const has4xx = metrics.some((m) => m.some((v) => v === '4XXError'));
      expect(has4xx).toBe(true);
    });

    it('API Gateway Requests includes 5XXError metric', () => {
      const widgets = resolveWidgets(buildStack().template);
      const metrics = widgets[4].properties.metrics;
      const has5xx = metrics.some((m) => m.some((v) => v === '5XXError'));
      expect(has5xx).toBe(true);
    });
  });

  describe('DDB Throttle widget', () => {
    it('DDB Throttled Requests widget uses math expressions', () => {
      const widgets = resolveWidgets(buildStack().template);
      const metrics = widgets[5].properties.metrics;
      const hasExpression = metrics.some((m) =>
        m.some((v) => typeof v === 'object' && v.expression),
      );
      expect(hasExpression).toBe(true);
    });

    it('DDB Throttled Requests has one expression per table', () => {
      const widgets = resolveWidgets(buildStack().template);
      const metrics = widgets[5].properties.metrics;
      const expressions = metrics.filter((m) =>
        m.some((v) => typeof v === 'object' && v.expression),
      );
      expect(expressions.length).toBe(3);
    });

    it('DDB expressions reference ReadThrottleEvents and WriteThrottleEvents', () => {
      const widgets = resolveWidgets(buildStack().template);
      const metrics = widgets[5].properties.metrics;
      const flat = JSON.stringify(metrics);
      expect(flat).toContain('ReadThrottleEvents');
      expect(flat).toContain('WriteThrottleEvents');
    });
  });

  describe('Payment Counts widget', () => {
    it('Payment Counts uses x402 namespace', () => {
      const widgets = resolveWidgets(buildStack().template);
      const metrics = widgets[6].properties.metrics;
      const flat = JSON.stringify(metrics);
      expect(flat).toContain('x402');
    });

    it('Payment Counts includes payment.verified metric', () => {
      const widgets = resolveWidgets(buildStack().template);
      const metrics = widgets[6].properties.metrics;
      const flat = JSON.stringify(metrics);
      expect(flat).toContain('payment.verified');
    });

    it('Payment Counts includes payment.failed metric', () => {
      const widgets = resolveWidgets(buildStack().template);
      const metrics = widgets[6].properties.metrics;
      const flat = JSON.stringify(metrics);
      expect(flat).toContain('payment.failed');
    });

    it('Payment Counts has 2 metrics', () => {
      const widgets = resolveWidgets(buildStack().template);
      const metrics = widgets[6].properties.metrics;
      expect(metrics.length).toBe(2);
    });
  });

  describe('Summary widget', () => {
    it('Summary widget has 4 metrics', () => {
      const widgets = resolveWidgets(buildStack().template);
      const metrics = widgets[7].properties.metrics;
      expect(metrics.length).toBe(4);
    });

    it('Summary includes API Requests count', () => {
      const widgets = resolveWidgets(buildStack().template);
      const metrics = widgets[7].properties.metrics;
      const flat = JSON.stringify(metrics);
      expect(flat).toContain('Count');
    });

    it('Summary includes payment.verified metric', () => {
      const widgets = resolveWidgets(buildStack().template);
      const metrics = widgets[7].properties.metrics;
      const flat = JSON.stringify(metrics);
      expect(flat).toContain('payment.verified');
    });

    it('Summary includes payment.failed metric', () => {
      const widgets = resolveWidgets(buildStack().template);
      const metrics = widgets[7].properties.metrics;
      const flat = JSON.stringify(metrics);
      expect(flat).toContain('payment.failed');
    });

    it('Summary includes tenant.signup metric', () => {
      const widgets = resolveWidgets(buildStack().template);
      const metrics = widgets[7].properties.metrics;
      const flat = JSON.stringify(metrics);
      expect(flat).toContain('tenant.signup');
    });

    it('Summary uses x402 namespace for custom metrics', () => {
      const widgets = resolveWidgets(buildStack().template);
      const metrics = widgets[7].properties.metrics;
      const flat = JSON.stringify(metrics);
      const x402Count = (flat.match(/x402/g) || []).length;
      expect(x402Count).toBeGreaterThanOrEqual(3);
    });
  });
});
