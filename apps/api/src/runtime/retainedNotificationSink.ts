import type { DatabaseConnection } from '../database/index.js';
import { recordNotificationOutputHistory } from '../repositories/notificationOutputHistoryRepository.js';
import type { NotificationOutputHistoryInput } from '../repositories/types.js';
import {
  assertWeatherData,
  sameWeatherEpoch,
  type DecisionBatch,
  type DecisionReceipt,
} from './weatherContracts.js';
import type { WeatherDecisionState } from './weatherDecisionState.js';

export interface NotificationRecordSink {
  record(records: readonly NotificationOutputHistoryInput[], onFailure?: () => void): void;
}
/** 保持書込みの所有者。取得側にはこのローカル注入口だけを与える。 */
export class RetainedNotificationSink implements NotificationRecordSink {
  private last: { fingerprint: string; receipt: DecisionReceipt } | null = null;
  constructor(
    private readonly connection: DatabaseConnection,
    private readonly state?: WeatherDecisionState,
  ) {}
  record(records: readonly NotificationOutputHistoryInput[]): void {
    this.connection.transaction(() => {
      for (const record of records) recordNotificationOutputHistory(this.connection, record);
    })();
  }
  receive(batch: DecisionBatch): DecisionReceipt {
    assertWeatherData(batch);
    const fingerprint = JSON.stringify(batch);
    if (this.last?.receipt.eventId === batch.eventId) {
      if (this.last.fingerprint !== fingerprint)
        throw new Error('同じ候補IDに異なる内容があります');
      return structuredClone(this.last.receipt);
    }
    const unit = this.state?.pendingUnit;
    if (
      !this.state ||
      !unit ||
      unit.unitId !== batch.unitId ||
      !sameWeatherEpoch(unit.epoch, batch.epoch) ||
      this.state.snapshot().revision !== batch.beforeRevision ||
      batch.after.revision !== batch.beforeRevision + 1
    )
      throw new Error('未登録または旧世代の通知候補です');
    const groups: DecisionReceipt['groups'][number][] = [];
    for (const group of batch.groups) {
      try {
        this.record(group.records);
        groups.push({ groupId: group.groupId, outcome: 'recorded' });
      } catch {
        groups.push({ groupId: group.groupId, outcome: 'record_failed' });
      }
    }
    this.state.accept(batch.unitId, batch.beforeRevision, batch.after);
    const receipt: DecisionReceipt = {
      eventId: batch.eventId,
      acceptedRevision: batch.after.revision,
      groups,
    };
    this.last = { fingerprint, receipt };
    return structuredClone(receipt);
  }
}
