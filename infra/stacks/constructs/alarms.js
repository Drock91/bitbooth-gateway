import { Duration } from 'aws-cdk-lib';
import {
  Alarm,
  ComparisonOperator,
  MathExpression,
  Metric,
  TreatMissingData,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

const ddbThrottleExpression = (table, period) =>
  new MathExpression({
    expression: 'r + w',
    usingMetrics: {
      r: new Metric({
        namespace: 'AWS/DynamoDB',
        metricName: 'ReadThrottleEvents',
        dimensionsMap: { TableName: table.tableName },
        period,
        statistic: 'Sum',
      }),
      w: new Metric({
        namespace: 'AWS/DynamoDB',
        metricName: 'WriteThrottleEvents',
        dimensionsMap: { TableName: table.tableName },
        period,
        statistic: 'Sum',
      }),
    },
    period,
  });

export class Alarms extends Construct {
  constructor(scope, id, { stage, lambdas, tables, apiGw }) {
    super(scope, id);

    this.alarmTopic = new Topic(this, 'AlarmTopic', {
      topicName: `x402-alarms-${stage}`,
      displayName: `x402 ${stage} alarms`,
    });
    const alarmTopic = this.alarmTopic;

    const snsAction = new SnsAction(alarmTopic);
    const gte = ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD;
    const safe = TreatMissingData.NOT_BREACHING;

    // Lambda error alarms (>= 5 in 5 min)
    for (const [name, fn] of lambdas.allFns) {
      const alarm = new Alarm(this, `${name}ErrorAlarm`, {
        alarmName: `x402-${stage}-${name.toLowerCase()}-errors`,
        alarmDescription: `${name} Lambda error count >= 5 in 5 min`,
        metric: fn.metricErrors({ period: Duration.minutes(5), statistic: 'Sum' }),
        threshold: 5,
        evaluationPeriods: 1,
        comparisonOperator: gte,
        treatMissingData: safe,
      });
      alarm.addAlarmAction(snsAction);
    }

    // API Gateway 5xx alarm
    const apiGw5xxAlarm = new Alarm(this, 'ApiGw5xxAlarm', {
      alarmName: `x402-${stage}-apigw-5xx`,
      alarmDescription: 'API Gateway 5xx error count >= 10 in 5 min',
      metric: apiGw.api.metricServerError({ period: Duration.minutes(5), statistic: 'Sum' }),
      threshold: 10,
      evaluationPeriods: 1,
      comparisonOperator: gte,
      treatMissingData: safe,
    });
    apiGw5xxAlarm.addAlarmAction(snsAction);

    // DDB throttle alarms (sum of read + write throttle events per table)
    for (const [name, table] of tables.all) {
      const alarm = new Alarm(this, `${name}ThrottleAlarm`, {
        alarmName: `x402-${stage}-ddb-${name.toLowerCase()}-throttles`,
        alarmDescription: `DDB ${name} table throttle events > 0 in 5 min`,
        metric: ddbThrottleExpression(table, Duration.minutes(5)),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: gte,
        treatMissingData: safe,
      });
      alarm.addAlarmAction(snsAction);
    }

    // API Gateway 4xx alarm
    const apiGw4xxAlarm = new Alarm(this, 'ApiGw4xxAlarm', {
      alarmName: `x402-${stage}-apigw-4xx`,
      alarmDescription: 'API Gateway 4xx error count >= 50 in 5 min',
      metric: apiGw.api.metricClientError({ period: Duration.minutes(5), statistic: 'Sum' }),
      threshold: 50,
      evaluationPeriods: 1,
      comparisonOperator: gte,
      treatMissingData: safe,
    });
    apiGw4xxAlarm.addAlarmAction(snsAction);

    // Lambda duration P99 alarms
    const durationFns = [
      ['Api', lambdas.apiFn, 8000],
      ['Webhook', lambdas.webhookFn, 8000],
      ['StripeWebhook', lambdas.stripeWebhookFn, 8000],
      ['Dashboard', lambdas.dashboardFn, 8000],
      ['DlqSweep', lambdas.dlqSweepFn, 240000],
      ['Fetch', lambdas.fetchFn, 12000],
    ];

    for (const [name, fn, thresholdMs] of durationFns) {
      const alarm = new Alarm(this, `${name}DurationP99Alarm`, {
        alarmName: `x402-${stage}-${name.toLowerCase()}-duration-p99`,
        alarmDescription: `${name} Lambda P99 duration >= ${thresholdMs}ms in 5 min`,
        metric: fn.metricDuration({ period: Duration.minutes(5), statistic: 'p99' }),
        threshold: thresholdMs,
        evaluationPeriods: 1,
        comparisonOperator: gte,
        treatMissingData: safe,
      });
      alarm.addAlarmAction(snsAction);
    }

    // SQS DLQ alarms
    for (const [name, queue] of [
      ['WebhookDlq', lambdas.webhookDlqQueue],
      ['StripeWebhookDlq', lambdas.stripeWebhookDlqQueue],
    ]) {
      const dlqAlarm = new Alarm(this, `${name}Alarm`, {
        alarmName: `x402-${stage}-sqs-${name.toLowerCase()}-messages`,
        alarmDescription: `SQS ${name} has messages pending (failed invocations)`,
        metric: queue.metricApproximateNumberOfMessagesVisible({
          period: Duration.minutes(5),
          statistic: 'Sum',
        }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: gte,
        treatMissingData: safe,
      });
      dlqAlarm.addAlarmAction(snsAction);
    }
  }
}
