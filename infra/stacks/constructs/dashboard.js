import { Duration } from 'aws-cdk-lib';
import {
  Dashboard,
  GraphWidget,
  SingleValueWidget,
  MathExpression,
  Metric,
} from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

export class OpsDashboard extends Construct {
  constructor(scope, id, { stage, lambdas, tables, apiGw }) {
    super(scope, id);

    const period = Duration.minutes(5);
    const dashName = `x402-${stage}`;

    this.dashboard = new Dashboard(this, 'Dashboard', {
      dashboardName: dashName,
    });

    // --- Lambda Errors ---
    const errorWidget = new GraphWidget({
      title: 'Lambda Errors',
      width: 12,
      height: 6,
      left: lambdas.allFns.map(([name, fn]) =>
        fn.metricErrors({ period, statistic: 'Sum', label: name }),
      ),
    });

    // --- Lambda Invocations ---
    const invocWidget = new GraphWidget({
      title: 'Lambda Invocations',
      width: 12,
      height: 6,
      left: lambdas.allFns.map(([name, fn]) =>
        fn.metricInvocations({ period, statistic: 'Sum', label: name }),
      ),
    });

    // --- Lambda Duration P99 ---
    const durationWidget = new GraphWidget({
      title: 'Lambda Duration P99',
      width: 12,
      height: 6,
      left: lambdas.allFns.map(([name, fn]) =>
        fn.metricDuration({ period, statistic: 'p99', label: name }),
      ),
    });

    // --- API Gateway Latency ---
    const apiLatencyWidget = new GraphWidget({
      title: 'API Gateway Latency',
      width: 12,
      height: 6,
      left: ['p50', 'p90', 'p99'].map((stat) =>
        apiGw.api.metricLatency({ period, statistic: stat, label: `Latency ${stat}` }),
      ),
    });

    // --- API Gateway Requests ---
    const apiRequestsWidget = new GraphWidget({
      title: 'API Gateway Requests',
      width: 12,
      height: 6,
      left: [
        apiGw.api.metricCount({ period, statistic: 'Sum', label: 'Total' }),
        apiGw.api.metricClientError({ period, statistic: 'Sum', label: '4xx' }),
        apiGw.api.metricServerError({ period, statistic: 'Sum', label: '5xx' }),
      ],
    });

    // --- DDB Throttled Requests (read + write events per table) ---
    const ddbThrottleWidget = new GraphWidget({
      title: 'DDB Throttled Requests',
      width: 12,
      height: 6,
      left: tables.all.map(([name, table], i) => {
        const rId = `r${i}`;
        const wId = `w${i}`;
        return new MathExpression({
          expression: `${rId} + ${wId}`,
          label: name,
          usingMetrics: {
            [rId]: new Metric({
              namespace: 'AWS/DynamoDB',
              metricName: 'ReadThrottleEvents',
              dimensionsMap: { TableName: table.tableName },
              period,
              statistic: 'Sum',
            }),
            [wId]: new Metric({
              namespace: 'AWS/DynamoDB',
              metricName: 'WriteThrottleEvents',
              dimensionsMap: { TableName: table.tableName },
              period,
              statistic: 'Sum',
            }),
          },
          period,
        });
      }),
    });

    // --- Payment Counts (custom EMF metrics) ---
    const paymentWidget = new GraphWidget({
      title: 'Payment Counts',
      width: 12,
      height: 6,
      left: [
        new Metric({
          namespace: 'x402',
          metricName: 'payment.verified',
          period,
          statistic: 'Sum',
          label: 'Verified',
        }),
        new Metric({
          namespace: 'x402',
          metricName: 'payment.failed',
          period,
          statistic: 'Sum',
          label: 'Failed',
        }),
      ],
    });

    // --- Summary row (single-value) ---
    const summaryWidget = new SingleValueWidget({
      title: 'Summary',
      width: 24,
      height: 3,
      metrics: [
        apiGw.api.metricCount({ period, statistic: 'Sum', label: 'API Requests' }),
        new Metric({
          namespace: 'x402',
          metricName: 'payment.verified',
          period,
          statistic: 'Sum',
          label: 'Payments OK',
        }),
        new Metric({
          namespace: 'x402',
          metricName: 'payment.failed',
          period,
          statistic: 'Sum',
          label: 'Payments Fail',
        }),
        new Metric({
          namespace: 'x402',
          metricName: 'tenant.signup',
          period,
          statistic: 'Sum',
          label: 'Signups',
        }),
      ],
    });

    this.dashboard.addWidgets(errorWidget, invocWidget);
    this.dashboard.addWidgets(durationWidget, apiLatencyWidget);
    this.dashboard.addWidgets(apiRequestsWidget, ddbThrottleWidget);
    this.dashboard.addWidgets(paymentWidget);
    this.dashboard.addWidgets(summaryWidget);
  }
}
