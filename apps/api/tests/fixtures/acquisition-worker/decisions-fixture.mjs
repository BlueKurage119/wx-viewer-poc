import { parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { register } from 'tsx/esm/api';
register();
const { WeatherTransport } = await import('../../../src/runtime/weatherTransport.ts');
const { createWorkerDecisions } = await import('../../../src/runtime/workerDecisions.ts');
const { aggregateFetchHealth } = await import('../../../src/monitoring/fetchHealthEvaluator.ts');
const { emitFetchHealthNotification } =
  await import('../../../src/notifications/fetchHealthNotificationEmitter.ts');
const connection = new Database(workerData.weatherPath);
const now = () => '2026-10-09T01:00:00.000Z';
let decisions;
let serial = 0;
const transport = new WeatherTransport(
  parentPort,
  workerData.epoch.workerGeneration,
  async (method, value) => {
    if (method === 'fixture.run') {
      return decisions.runUpdate(
        {
          scopes: [value.target],
          initialWarningKeys: [`${value.target}|normal`],
          initialBosaiKeys: [`${value.target}|normal`],
        },
        () => {
          connection.prepare('INSERT INTO fixture_commit (target) VALUES (?)').run(value.target);
          const recorded = [];
          if (decisions.warning.isPending(value.target, 'normal')) {
            decisions.warning.markDone(value.target, 'normal');
            recorded.push('warning');
          }
          if (!decisions.bosai.isCompleted(value.target, 'normal')) {
            decisions.bosai.markCompleted(value.target, 'normal');
            recorded.push('bosai');
          }
          decisions.bosai.setCollecting(false);
          for (const source of recorded)
            decisions.recordSink.record([
              {
                notificationId: `${workerData.epoch.workerGeneration}-${value.target}-${source}`,
                category: 'warning',
                sourceType: source,
                sourceVersion: null,
                targetAreaJson: null,
                occurredAt: now(),
                detectedAt: now(),
                changeType: 'new',
                ackRequired: false,
                summary: '初回通知の試験',
                relatedRefsJson: '[]',
                origin: 'weather',
                detectionContext: 'initial',
                isTraining: false,
                messageDefinitionId: null,
                messageDefinitionVersion: null,
                weatherDatabaseGenerationId: workerData.epoch.weatherDatabaseGenerationId,
              },
            ]);
          return recorded;
        },
      );
    }
    if (method === 'fixture.health') {
      return decisions.runUpdate({ scopes: [], initialWarningKeys: [], initialBosaiKeys: [] }, () =>
        emitFetchHealthNotification(
          undefined,
          aggregateFetchHealth(
            [
              {
                sourceId: 'xml_regular',
                status: value.status,
                reasons:
                  value.status === 'normal'
                    ? []
                    : [
                        {
                          kind: 'consecutive_failures',
                          status: value.status,
                          sourceKind: 'xml_regular',
                          text: '連続失敗',
                        },
                      ],
                lastAttemptAt: now(),
                lastSuccessAt: now(),
                maxConsecutiveFailures: value.status === 'normal' ? 0 : 2,
                intervalSeconds: 60,
                lastDurationMs: 100,
              },
            ],
            now(),
          ),
          decisions.health,
          {
            now,
            recordSink: decisions.recordSink,
            notificationIdFactory: () => `${workerData.epoch.workerGeneration}-health-${++serial}`,
          },
        ),
      );
    }
    if (method === 'fixture.pause') return decisions.pause(value.token, value.expiresAt);
    if (method === 'fixture.release') return decisions.release(value.token);
    if (method === 'fixture.inspect')
      return {
        warning: decisions.warning.exportSnapshot(),
        bosai: decisions.bosai.exportSnapshot(),
        health: decisions.health.exportSnapshot(),
      };
    throw new Error('invalid_request');
  },
  () => {},
);
async function latch(stage) {
  if (workerData.stage !== stage) return;
  await transport.call('fixture.latch', { stage });
  await new Promise(() => {});
}
// 境界の停止だけを挟み、更新・判定・保存・ACKは本番の実装を通す。
const controlledTransport = {
  async call(method, value) {
    if (method === 'update.begin') await latch('before_begin');
    if (method === 'decision.batch') await latch('after_commit');
    if (method === 'update.complete') await latch('after_ack');
    const result = await transport.call(method, value);
    if (method === 'update.begin') await latch('after_begin');
    if (method === 'update.complete') await latch('after_complete');
    return result;
  },
};
decisions = createWorkerDecisions(workerData.epoch, workerData.checkpoint, controlledTransport);
await transport.call('fixture.ready', null);
