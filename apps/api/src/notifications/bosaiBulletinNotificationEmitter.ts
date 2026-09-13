import crypto from 'node:crypto';
import {
  VENUE_IDS,
  type NotificationDetectionContext,
  type UtcIso8601String,
  type VenueId,
  type WeatherNotification,
} from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import { listBosaiBulletins, recordNotificationOutputHistory } from '../repositories/index.js';
import type { BosaiBulletin, TelegramReception } from '../repositories/types.js';
import {
  planBosaiBulletinNotifications,
  type PlannedBosaiBulletinNotification,
} from './bosaiBulletinNotificationPlanner.js';
import { toNotificationOutputHistoryInput } from './notificationOutputHistoryMapper.js';

export interface InitialBosaiNotificationState {
  isCompleted(venueId: VenueId, status: 'normal' | 'training'): boolean;
  markCompleted(venueId: VenueId, status: 'normal' | 'training'): void;
  isCollecting(): boolean;
  setCollecting(value: boolean): void;
}

export class InitialBosaiNotificationTracker implements InitialBosaiNotificationState {
  private collecting = true;
  private readonly completedKeys = new Set<string>();

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
  readonly now: () => UtcIso8601String;
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
  // 初期取得中は通知を抑止（保存のみ行い、初期取得完了時に一括評価）
  if (deps.initialState.isCollecting()) {
    return { recordedCount: 0, failed: false };
  }

  if (current.controlStatus === 'test') {
    return { recordedCount: 0, failed: false };
  }

  let totalRecorded = 0;
  let hasFailed = false;

  for (const venueId of VENUE_IDS) {
    const isCompleted = deps.initialState.isCompleted(
      venueId,
      current.controlStatus as 'normal' | 'training',
    );
    const detectionContext: NotificationDetectionContext = isCompleted ? 'normal' : 'initial';

    const plan = planBosaiBulletinNotifications({
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
        const tx = connection.transaction(() => {
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
            );
            recordNotificationOutputHistory(connection, recordInput);
          }
        });
        tx();
        totalRecorded += plan.notifications.length;
      } catch (error) {
        console.error('Failed to record bosai bulletin notification output history:', error);
        hasFailed = true;
      }
    }
  }

  return {
    recordedCount: totalRecorded,
    failed: hasFailed,
  };
}

export function emitInitialBosaiBulletinNotifications(
  connection: DatabaseConnection,
  venueId: VenueId,
  deps: BosaiNotificationEmitDeps,
): void {
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
        const tx = connection.transaction(() => {
          for (const planned of plannedForVenue) {
            const recordInput = toNotificationOutputHistoryInput(
              planned.notification,
              planned.output,
            );
            recordNotificationOutputHistory(connection, recordInput);
          }
        });
        tx();
      } catch (error) {
        console.error(
          'Failed to record initial bosai bulletin notification output history:',
          error,
        );
      }
    }

    deps.initialState.markCompleted(venueId, status);
  }

  const allCompleted = VENUE_IDS.every(
    (v) =>
      deps.initialState.isCompleted(v, 'normal') && deps.initialState.isCompleted(v, 'training'),
  );
  if (allCompleted) {
    deps.initialState.setCollecting(false);
  }
}
