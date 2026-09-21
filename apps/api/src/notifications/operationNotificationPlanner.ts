import type {
  FetchControlOperationKind,
  NotificationMessageDefinitionId,
  ResolvedNotificationOutputSnapshot,
  SystemNotification,
  UtcIso8601String,
} from '@wx-viewer-poc/shared';
import { resolveNotificationMessage } from '@wx-viewer-poc/shared';

/**
 * Issue #43 §6: 操作結果 → SystemNotification + 出力スナップショットの決定（純粋関数）。
 * 開始・停止の failure には対応する通知定義が存在しないため、通知を生成しない（null を返す）。
 */

const FIXED_TARGET = {
  kind: 'equipment' as const,
  codeType: 'wx-viewer-poc/fetch-control',
  code: 'all',
  name: '防災気象情報',
};

export interface PlanOperationNotificationInput {
  readonly operationKind: FetchControlOperationKind;
  readonly result: 'success' | 'failure';
  readonly requestId: string;
  readonly completedAt: UtcIso8601String;
  readonly notificationIdFactory: () => string;
  /** 強制更新失敗時のみ使用。§5.6 のとおり200文字以内・改行なしに整形済みであること。 */
  readonly failureDetail?: string | null;
  /** 操作記録に載せる errorCode。'force_refresh_aborted' のとき中断専用の通知定義を選ぶ。 */
  readonly errorCode?: string | null;
}

export interface PlannedOperationNotification {
  readonly notification: SystemNotification;
  readonly output: ResolvedNotificationOutputSnapshot;
}

function buildBaseNotification(
  requestId: string,
  completedAt: UtcIso8601String,
  changeType: string,
  category: 'warning' | 'question',
  notificationIdFactory: () => string,
): SystemNotification {
  return {
    notificationId: notificationIdFactory(),
    origin: 'system',
    category,
    changeType,
    sourceType: 'fetch_control',
    sourceVersion: null,
    targets: [FIXED_TARGET],
    occurredAt: completedAt,
    detectedAt: completedAt,
    relatedRefs: [{ type: 'operation_request', ref: requestId }],
    detectionContext: 'normal',
    isTraining: false,
  };
}

export function planOperationNotification(
  input: PlanOperationNotificationInput,
): PlannedOperationNotification | null {
  let definitionId: NotificationMessageDefinitionId;
  let changeType: string;
  let category: 'warning' | 'question';
  let omitTarget = true;
  let detail: string | undefined;

  if (input.operationKind === 'start') {
    if (input.result !== 'success') {
      return null;
    }
    definitionId = 'system-fetch-manually-started';
    changeType = 'fetch_manually_started';
    category = 'warning';
  } else if (input.operationKind === 'stop') {
    if (input.result !== 'success') {
      return null;
    }
    definitionId = 'system-fetch-manually-stopped';
    changeType = 'fetch_manually_stopped';
    category = 'warning';
  } else {
    // force_refresh
    if (input.result === 'success') {
      definitionId = 'system-force-fetch-completed';
      changeType = 'force_fetch_completed';
      category = 'warning';
    } else if (input.errorCode === 'force_refresh_aborted') {
      definitionId = 'system-force-fetch-aborted';
      changeType = 'force_fetch_aborted';
      category = 'warning';
      omitTarget = true;
      detail = undefined;
    } else {
      definitionId = 'system-force-fetch-failed';
      changeType = 'force_fetch_failed';
      category = 'question';
      omitTarget = false;
      detail = input.failureDetail ?? undefined;
    }
  }

  const notification = buildBaseNotification(
    input.requestId,
    input.completedAt,
    changeType,
    category,
    input.notificationIdFactory,
  );

  const output = resolveNotificationMessage(notification, {
    definitionId,
    detail,
    omitTarget,
  });

  return { notification, output };
}

export interface PlanServiceStoppedNotificationInput {
  readonly completedAt: UtcIso8601String;
  readonly notificationIdFactory: () => string;
}

/** Issue #43 §6.1: graceful shutdown フックが発する「サービス停止」通知。 */
export function planServiceStoppedNotification(
  input: PlanServiceStoppedNotificationInput,
): PlannedOperationNotification {
  const notification: SystemNotification = {
    notificationId: input.notificationIdFactory(),
    origin: 'system',
    category: 'question',
    changeType: 'service_stopped',
    sourceType: 'fetch_control',
    sourceVersion: null,
    targets: [FIXED_TARGET],
    occurredAt: input.completedAt,
    detectedAt: input.completedAt,
    relatedRefs: [],
    detectionContext: 'normal',
    isTraining: false,
  };

  const output = resolveNotificationMessage(notification, {
    definitionId: 'system-service-stopped',
  });

  return { notification, output };
}
