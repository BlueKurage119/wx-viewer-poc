import { randomUUID } from 'node:crypto';
import { FetchHealthStateStore } from '../monitoring/fetchHealthStateStore.js';
import { InitialWarningNotificationTracker } from '../notifications/initialWarningNotificationTracker.js';
import { InitialBosaiNotificationTracker } from '../notifications/bosaiBulletinNotificationEmitter.js';
import type { NotificationOutputHistoryInput } from '../repositories/types.js';
import type { NotificationRecordSink } from './retainedNotificationSink.js';
import type { DecisionCheckpoint, DecisionReceipt, WeatherEpoch } from './weatherContracts.js';
import type { DecisionScope } from './weatherDecisionRuntime.js';
import type { WeatherTransport } from './weatherTransport.js';

export function createWorkerDecisions(
  epoch: WeatherEpoch,
  initial: DecisionCheckpoint,
  transport: WeatherTransport,
) {
  const warning = new InitialWarningNotificationTracker();
  const bosai = new InitialBosaiNotificationTracker();
  const health = new FetchHealthStateStore();
  warning.importSnapshot(initial.warningDoneKeys);
  bosai.importSnapshot({
    completedKeys: initial.bosaiCompletedKeys,
    collecting: initial.bosaiCollecting,
  });
  health.importSnapshot(initial.fetchHealth);
  let revision = initial.revision;
  let tail = Promise.resolve();
  let failed = false;
  let groups: { groupId: string; records: readonly NotificationOutputHistoryInput[] }[] | null =
    null;
  const handlers = new Map<string, () => void>();
  let releasePause: (() => void) | null = null;
  let pauseToken: string | null = null;
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const recordSink: NotificationRecordSink = {
    record(records, onFailure) {
      if (!groups) throw new Error('更新単位外の通知候補です');
      const groupId = randomUUID();
      groups.push({ groupId, records: structuredClone(records) });
      if (onFailure) handlers.set(groupId, onFailure);
    },
  };
  return {
    warning,
    bosai,
    health,
    recordSink,
    fail() {
      failed = true;
      releasePause?.();
    },
    runUpdate<T>(scope: DecisionScope, work: () => T): Promise<T> {
      return enqueue(async () => {
        if (failed) throw new Error('protocol_error');
        const unitId = randomUUID();
        let completed = false;
        try {
          await transport.call('update.begin', {
            unitId,
            epoch,
            beforeRevision: revision,
            ...scope,
          });
          groups = [];
          let value: T | undefined;
          let workError: unknown;
          try {
            value = work();
          } catch (error) {
            workError = error;
          }
          const after: DecisionCheckpoint = {
            revision: revision + 1,
            warningDoneKeys: warning.exportSnapshot(),
            bosaiCompletedKeys: bosai.exportSnapshot().completedKeys,
            bosaiCollecting: bosai.exportSnapshot().collecting,
            fetchHealth: health.exportSnapshot(),
          };
          const receipt = await transport.call<DecisionReceipt>('decision.batch', {
            eventId: randomUUID(),
            unitId,
            epoch,
            beforeRevision: revision,
            after,
            groups,
          });
          revision = receipt.acceptedRevision;
          for (const group of receipt.groups)
            if (group.outcome === 'record_failed') handlers.get(group.groupId)?.();
          await transport.call('update.complete', { unitId, epoch, acceptedRevision: revision });
          completed = true;
          if (workError) throw workError;
          return value as T;
        } catch (error) {
          if (!completed) failed = true;
          throw error;
        } finally {
          groups = null;
          handlers.clear();
        }
      });
    },
    pause(token: string, expiresAt: string): Promise<{ revision: number }> {
      return new Promise((resolve, reject) => {
        void enqueue(async () => {
          const remaining = Date.parse(expiresAt) - Date.now();
          if (remaining <= 0) throw new Error('deadline_exceeded');
          pauseToken = token;
          await new Promise<void>((release) => {
            const timer = setTimeout(() => {
              releasePause = null;
              pauseToken = null;
              release();
            }, remaining);
            releasePause = () => {
              clearTimeout(timer);
              releasePause = null;
              pauseToken = null;
              release();
            };
            resolve({ revision });
          });
        }).catch(reject);
      });
    },
    release(token: string) {
      if (pauseToken === token) releasePause?.();
      return { released: pauseToken === null };
    },
    drain: () => tail,
  };
}
