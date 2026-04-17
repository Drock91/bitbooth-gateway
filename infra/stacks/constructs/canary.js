import { Duration } from 'aws-cdk-lib';
import { Canary, Code, Runtime, Schedule, Test } from 'aws-cdk-lib/aws-synthetics';
import { Alarm, ComparisonOperator, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Construct } from 'constructs';

const CANARY_CODE = [
  "const synthetics = require('Synthetics');",
  "const log = require('SyntheticsLogger');",
  "const https = require('https');",
  '',
  'const handler = async function () {',
  '  const url = process.env.CANARY_TARGET_URL;',
  "  log.info('Checking ' + url);",
  '  const body = await new Promise((resolve, reject) => {',
  '    https.get(url, (res) => {',
  '      if (res.statusCode !== 200) {',
  "        reject(new Error('HTTP ' + res.statusCode));",
  '        return;',
  '      }',
  "      let data = '';",
  "      res.on('data', (c) => (data += c));",
  "      res.on('end', () => resolve(data));",
  "    }).on('error', reject);",
  '  });',
  '  const parsed = JSON.parse(body);',
  "  if (parsed.status !== 'ok') {",
  "    throw new Error('Health status: ' + parsed.status);",
  '  }',
  "  log.info('Health check passed');",
  '};',
  '',
  'exports.handler = handler;',
].join('\n');

export class HealthCanary extends Construct {
  constructor(scope, id, { stage, apiGw, alarmTopic }) {
    super(scope, id);

    const targetUrl = apiGw.api.url + 'v1/health/ready';

    this.canary = new Canary(this, 'HealthCanary', {
      canaryName: `x402-${stage}-health`,
      runtime: Runtime.SYNTHETICS_NODEJS_PUPPETEER_9_1,
      test: Test.custom({
        code: Code.fromInline(CANARY_CODE),
        handler: 'index.handler',
      }),
      schedule: Schedule.rate(Duration.minutes(stage === 'prod' ? 5 : 15)),
      environmentVariables: {
        CANARY_TARGET_URL: targetUrl,
      },
      successRetentionPeriod: Duration.days(7),
      failureRetentionPeriod: Duration.days(14),
    });

    const alarm = new Alarm(this, 'HealthCanaryAlarm', {
      alarmName: `x402-${stage}-health-canary-failed`,
      alarmDescription: 'Health canary success rate < 100% in 10 min',
      metric: this.canary.metricSuccessPercent({
        period: Duration.minutes(10),
      }),
      threshold: 100,
      evaluationPeriods: 2,
      comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.BREACHING,
    });

    if (alarmTopic) {
      alarm.addAlarmAction(new SnsAction(alarmTopic));
    }
  }
}
