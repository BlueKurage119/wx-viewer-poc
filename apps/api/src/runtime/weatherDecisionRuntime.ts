import { randomUUID } from 'node:crypto';
import type { DatabaseConnection } from '../database/index.js';
import { FetchHealthStateStore } from '../monitoring/fetchHealthStateStore.js';
import { InitialWarningNotificationTracker } from '../notifications/initialWarningNotificationTracker.js';
import { InitialBosaiNotificationTracker } from '../notifications/bosaiBulletinNotificationEmitter.js';
import type { NotificationOutputHistoryInput } from '../repositories/types.js';
import type { WeatherEpoch } from './weatherContracts.js';
import { WeatherDecisionState } from './weatherDecisionState.js';
import {
  RetainedNotificationSink,
  type NotificationRecordSink,
} from './retainedNotificationSink.js';
import type { WeatherPublicationGate } from './weatherPublication.js';

export interface DecisionScope {
  readonly scopes: readonly string[];
  readonly initialWarningKeys: readonly string[];
  readonly initialBosaiKeys: readonly string[];
}
/** 同期commit/判定だけを囲む。ネットワーク待機や復旧探索は呼出元で完了させる。 */
export function createWeatherDecisionRuntime(
  connection: DatabaseConnection,
  epoch: WeatherEpoch,
  gate: WeatherPublicationGate,
  failpoint?: (
    stage: 'before_register' | 'registered' | 'weather_committed' | 'received' | 'acknowledged',
  ) => void,
) {
  const state = new WeatherDecisionState(epoch);
  const sink = new RetainedNotificationSink(connection, state);
  const warning = new InitialWarningNotificationTracker();
  const bosai = new InitialBosaiNotificationTracker();
  const health = new FetchHealthStateStore();
  let groups: { groupId: string; records: readonly NotificationOutputHistoryInput[] }[] | null =
    null;
  const failureHandlers = new Map<string, () => void>();
  const recordSink: NotificationRecordSink = {
    record(records, onFailure) {
      if (groups === null) throw new Error('更新単位外の通知候補です');
      const groupId = randomUUID();
      groups.push({ groupId, records: structuredClone(records) });
      if (onFailure) failureHandlers.set(groupId, onFailure);
    },
  };
  function runSync<T>(scope: DecisionScope, work: () => T): T {
    let interrupted = false;
    const hit = (stage: Parameters<NonNullable<typeof failpoint>>[0]) => {
      try {
        failpoint?.(stage);
      } catch (error) {
        interrupted = true;
        throw error;
      }
    };
    hit('before_register');
    const before = state.snapshot();
    const unitId = randomUUID();
    state.begin({ unitId, epoch, beforeRevision: before.revision, ...scope });
    groups = [];
    const receive = () => {
      const bosaiState = bosai.exportSnapshot();
      const receipt = sink.receive({
        eventId: randomUUID(),
        unitId,
        epoch,
        beforeRevision: before.revision,
        after: {
          revision: before.revision + 1,
          warningDoneKeys: warning.exportSnapshot(),
          bosaiCompletedKeys: bosaiState.completedKeys,
          bosaiCollecting: bosaiState.collecting,
          fetchHealth: health.exportSnapshot(),
        },
        groups: groups ?? [],
      });
      for (const group of receipt.groups)
        if (group.outcome === 'record_failed') failureHandlers.get(group.groupId)?.();
      return receipt;
    };
    try {
      hit('registered');
      const result = work();
      hit('weather_committed');
      const receipt = receive();
      hit('received');
      state.complete(unitId);
      hit('acknowledged');
      if (receipt.groups.some((group) => group.outcome === 'record_failed'))
        console.error('[api] 通知候補の保存に失敗しました。補完は行いません。');
      return result;
    } catch (error) {
      if (interrupted) state.replaceEpoch(epoch);
      else if (state.pendingUnit) {
        // 通常例外では、実際に評価済みの状態だけ確定し、未着手の初回keyを消費しない。
        if (state.snapshot().revision === before.revision) receive();
        state.complete(unitId);
      }
      const checkpoint = state.snapshot();
      warning.importSnapshot(checkpoint.warningDoneKeys);
      bosai.importSnapshot({
        completedKeys: checkpoint.bosaiCompletedKeys,
        collecting: checkpoint.bosaiCollecting,
      });
      health.importSnapshot(checkpoint.fetchHealth);
      throw error;
    } finally {
      groups = null;
      failureHandlers.clear();
    }
  }
  function replaceEpoch(next: WeatherEpoch): void {
    state.replaceEpoch(next);
    epoch = { ...next };
    const checkpoint = state.snapshot();
    warning.importSnapshot(checkpoint.warningDoneKeys);
    bosai.importSnapshot({
      completedKeys: checkpoint.bosaiCompletedKeys,
      collecting: checkpoint.bosaiCollecting,
    });
    health.importSnapshot(checkpoint.fetchHealth);
  }
  return {
    state,
    recordSink,
    warning,
    bosai,
    health,
    runSync,
    replaceEpoch,
    runUpdate: <T>(scope: DecisionScope, work: () => T) =>
      gate.runUpdate(() => runSync(scope, work)),
  };
}
