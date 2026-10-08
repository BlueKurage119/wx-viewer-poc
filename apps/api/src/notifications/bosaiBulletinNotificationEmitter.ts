import {
  RetainedNotificationSink,
  type NotificationRecordSink,
} from '../runtime/retainedNotificationSink.js';
import crypto from 'node:crypto';
import {
  type NotificationDetectionContext,
  type UtcIso8601String,
  type VenueId,
  type VenueRegistry,
  type WeatherNotification,
} from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import { listBosaiBulletins } from '../repositories/index.js';
import type { BosaiBulletin, TelegramReception } from '../repositories/types.js';
import {
  planBosaiBulletinNotifications,
  type PlannedBosaiBulletinNotification,
} from './bosaiBulletinNotificationPlanner.js';
import { toNotificationOutputHistoryInput } from './notificationOutputHistoryMapper.js';

export interface InitialBosaiNotificationState {
  exportSnapshot(): { readonly completedKeys: readonly string[]; readonly collecting: boolean };
  importSnapshot(snapshot: {
    readonly completedKeys: readonly string[];
    readonly collecting: boolean;
  }): void;
  isCompleted(venueId: VenueId, status: 'normal' | 'training'): boolean;
  markCompleted(venueId: VenueId, status: 'normal' | 'training'): void;
  isCollecting(): boolean;
  setCollecting(value: boolean): void;
}

export class InitialBosaiNotificationTracker implements InitialBosaiNotificationState {
  private collecting = true;
  private readonly completedKeys = new Set<string>();

  exportSnapshot() {
    return { completedKeys: [...this.completedKeys], collecting: this.collecting };
  }
  importSnapshot(snapshot: {
    readonly completedKeys: readonly string[];
    readonly collecting: boolean;
  }): void {
    this.completedKeys.clear();
    for (const key of snapshot.completedKeys) this.completedKeys.add(key);
    this.collecting = snapshot.collecting;
  }

  isCompleted(venueId: VenueId, status: 'normal' | 'training'): boolean {
    return this.completedKeys.has(`${venueId}|${status}`);
  }

  markCompleted(venueId: VenueId, status: 'normal' | 'training'): void {
    this.completedKeys.add(`${venueId}|${status}`);
  }

  isCollecting(): boolean {
    return this.collecting;
  }

  setCollecting(value: boolean): void {
    this.collecting = value;
  }

  reset(): void {
    this.collecting = true;
    this.completedKeys.clear();
  }
}

export interface BosaiNotificationEmitDeps {
  readonly venueRegistry: VenueRegistry;
  readonly now: () => UtcIso8601String;
  readonly retainedConnection?: DatabaseConnection;
  readonly recordSink?: NotificationRecordSink;
  readonly weatherDatabaseGenerationId: string;
  readonly notificationIdFactory?: () => string;
  readonly initialState: InitialBosaiNotificationState;
}

export interface BosaiNotificationEmitResult {
  readonly recordedCount: number;
  readonly failed: boolean;
}

export function emitBosaiBulletinNotificationsForReception(
  connection: DatabaseConnection,
  reception: TelegramReception,
  previous: BosaiBulletin | null,
  current: BosaiBulletin,
  deps: BosaiNotificationEmitDeps,
): BosaiNotificationEmitResult {
  if (connection.inTransaction) throw new Error('気象transaction完了前の通知保存は禁止です');
  // 初期取得中は通知を抑止（保存のみ行い、初期取得完了時に一括評価）
  if (deps.initialState.isCollecting()) {
    return { recordedCount: 0, failed: false };
  }

  if (current.controlStatus === 'test') {
    return { recordedCount: 0, failed: false };
  }

  const result = { recordedCount: 0, failed: false };

  for (const venueId of deps.venueRegistry.listVenueIds()) {
    const isCompleted = deps.initialState.isCompleted(
      venueId,
      current.controlStatus as 'normal' | 'training',
    );
    const detectionContext: NotificationDetectionContext = isCompleted ? 'normal' : 'initial';

    const plan = planBosaiBulletinNotifications({
      venueRegistry: deps.venueRegistry,
      current,
      previous,
      venueId,
      detectionContext,
      detectedAt: reception.receivedAt,
      notificationIdFactory: deps.notificationIdFactory ?? (() => crypto.randomUUID()),
    });

    for (const skip of plan.skipped) {
      console.warn(
        `Bosai bulletin notification skipped for receptionId=${reception.id} eventId=${current.eventId} venueId=${venueId}: [${skip.reason}] ${skip.detail}`,
      );
    }

    if (plan.notifications.length > 0) {
      try {
        const records = [];
        {
          for (const planned of plan.notifications) {
            const notificationWithReception: WeatherNotification = {
              ...planned.notification,
              relatedRefs: [
                ...planned.notification.relatedRefs,
                { type: 'telegram_reception', ref: String(reception.id) },
              ],
            };
            const recordInput = toNotificationOutputHistoryInput(
              notificationWithReception,
              planned.output,
              deps.weatherDatabaseGenerationId,
            );
            records.push(recordInput);
          }
        }
        resolveSink(deps).record(records, () => {
          result.recordedCount -= plan.notifications.length;
          result.failed = true;
        });
        result.recordedCount += plan.notifications.length;
      } catch (error) {
        console.error('Failed to record bosai bulletin notification output history:', error);
        result.failed = true;
      }
    }
  }

  return result;
}

export function emitInitialBosaiBulletinNotifications(
  connection: DatabaseConnection,
  venueId: VenueId,
  deps: BosaiNotificationEmitDeps,
): void {
  if (connection.inTransaction) throw new Error('気象transaction完了前の通知保存は禁止です');
  const targetStatuses: readonly ('normal' | 'training')[] = ['normal', 'training'];

  for (const status of targetStatuses) {
    if (deps.initialState.isCompleted(venueId, status)) {
      continue;
    }

    const bulletins = listBosaiBulletins(connection, {
      controlStatus: status,
    });

    const plannedForVenue: PlannedBosaiBulletinNotification[] = [];

    for (const bulletin of bulletins) {
      if (bulletin.isCancelled) {
        continue;
      }

      const plan = planBosaiBulletinNotifications({
        venueRegistry: deps.venueRegistry,
        current: bulletin,
        previous: null,
        venueId,
        detectionContext: 'initial',
        detectedAt: deps.now(),
        notificationIdFactory: deps.notificationIdFactory ?? (() => crypto.randomUUID()),
      });

      for (const skip of plan.skipped) {
        console.warn(
          `Initial bosai bulletin notification skipped for ${venueId}: [${skip.reason}] ${skip.detail}`,
        );
      }

      plannedForVenue.push(...plan.notifications);
    }

    if (plannedForVenue.length > 0) {
      try {
        const records = [];
        {
          for (const planned of plannedForVenue) {
            const recordInput = toNotificationOutputHistoryInput(
              planned.notification,
              planned.output,
              deps.weatherDatabaseGenerationId,
            );
            records.push(recordInput);
          }
        }
        resolveSink(deps).record(records);
      } catch (error) {
        console.error(
          'Failed to record initial bosai bulletin notification output history:',
          error,
        );
      }
    }

    deps.initialState.markCompleted(venueId, status);
  }

  const allCompleted = deps.venueRegistry
    .listVenueIds()
    .every(
      (v) =>
        deps.initialState.isCompleted(v, 'normal') && deps.initialState.isCompleted(v, 'training'),
    );
  if (allCompleted) {
    deps.initialState.setCollecting(false);
  }
}

function resolveSink(deps: {
  readonly recordSink?: NotificationRecordSink;
  readonly retainedConnection?: DatabaseConnection;
}): NotificationRecordSink {
  if (deps.recordSink) return deps.recordSink;
  if (deps.retainedConnection) return new RetainedNotificationSink(deps.retainedConnection);
  throw new Error('保持通知sinkが構成されていません');
}
