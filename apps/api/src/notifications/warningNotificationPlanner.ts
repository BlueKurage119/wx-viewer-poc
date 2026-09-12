import {
  type NotificationCategory,
  type NotificationMessageDefinitionId,
  type NotificationRelatedRef,
  type NotificationTarget,
  type ResolvedNotificationOutputSnapshot,
  type UtcIso8601String,
  type WeatherNotification,
  type WeatherNotificationChangeType,
  resolveNotificationMessage,
} from '@wx-viewer-poc/shared';
import type {
  ControlStatus,
  WarningCurrentChange,
  WarningCurrentItemInput,
  WarningPhenomenonKey,
  WarningTelegramType,
} from '../repositories/types.js';
import { classifyWarningNotificationCategory } from './warningNotificationCategoryClassifier.js';
import {
  decideWarningStateChangeNotification,
  isWarningStateChangeDecisionInput,
} from './warningStateChangeNotificationDecider.js';
import {
  selectIssuedNotificationDefinitionId,
  selectWarningNotificationDefinitionId,
} from './warningNotificationDefinitionSelector.js';
import { WARNING_CODE_TABLE } from '../polling/jmaWarningCurrentReducer.js';

/** 通知生成のきっかけ。InfoType（電文の軸）と初期取得（プロセスの軸）を 1 つに束ねる。 */
export type WarningNotificationTrigger =
  | {
      readonly kind: 'reception';
      readonly infoType: '発表' | '訂正' | '取消';
      readonly telegramType: WarningTelegramType;
      readonly receptionId: number;
    }
  | { readonly kind: 'initial' };

export interface WarningNotificationContext {
  readonly areaCode: string;
  readonly areaName: string;
  readonly controlStatus: ControlStatus;
  readonly sourceVersion: string | null;
  /** 適用後スナップショットの telegram.reportDateTime。 */
  readonly reportDateTime: UtcIso8601String;
  readonly detectedAt: UtcIso8601String;
  /** 訂正・初期取得で現況アイテムを参照するため、適用後スナップショットの items を渡す。 */
  readonly currentItems: readonly WarningCurrentItemInput[];
}

export interface PlannedWarningNotification {
  readonly notification: WeatherNotification;
  readonly output: ResolvedNotificationOutputSnapshot;
}

export type WarningNotificationSkipReason =
  | 'continued'
  | 'unclassifiable_kind_code'
  | 'unmapped_definition'
  | 'state_change_decision_failed'
  | 'message_resolution_failed'
  | 'unexpected_change_on_cancel'
  | 'control_status_not_notifiable';

export interface WarningNotificationSkip {
  readonly phenomenonKey: WarningPhenomenonKey | null;
  readonly changeType: WeatherNotificationChangeType | null;
  readonly reason: WarningNotificationSkipReason;
  readonly detail: string;
}

export interface WarningNotificationPlan {
  readonly notifications: readonly PlannedWarningNotification[];
  readonly skipped: readonly WarningNotificationSkip[];
}

export interface PlanWarningNotificationsInput {
  readonly trigger: WarningNotificationTrigger;
  readonly changes: readonly WarningCurrentChange[];
  readonly context: WarningNotificationContext;
  readonly detectionContext: 'normal' | 'initial';
  readonly notificationIdFactory: () => string;
}

/**
 * 副作用も例外も持たない。判定不能はすべて skipped へ落とす。
 */
export function planWarningNotifications(
  input: PlanWarningNotificationsInput,
): WarningNotificationPlan {
  const { trigger, changes, context, detectionContext, notificationIdFactory } = input;
  const notifications: PlannedWarningNotification[] = [];
  const skipped: WarningNotificationSkip[] = [];

  // §4.8 / H2: test (試験報) からは通知を生成しない
  if (context.controlStatus === 'test') {
    if (changes.length === 0) {
      skipped.push({
        phenomenonKey: null,
        changeType: null,
        reason: 'control_status_not_notifiable',
        detail: 'test controlStatus is not notifiable',
      });
    } else {
      for (const change of changes) {
        skipped.push({
          phenomenonKey: change.phenomenonKey,
          changeType: change.changeType,
          reason: 'control_status_not_notifiable',
          detail: `test controlStatus is not notifiable for ${change.phenomenonKey}`,
        });
      }
    }
    return { notifications, skipped };
  }

  const isTraining = context.controlStatus === 'training';
  const target: NotificationTarget = {
    kind: 'area',
    codeType: 'jma_municipal_warning_area',
    code: context.areaCode,
    name: context.areaName,
  };

  const relatedRefs: readonly NotificationRelatedRef[] =
    trigger.kind === 'reception'
      ? [
          { type: 'warning_current', ref: context.areaCode },
          { type: 'telegram_reception', ref: String(trigger.receptionId) },
        ]
      : [{ type: 'warning_current', ref: context.areaCode }];

  function tryCreateNotification(params: {
    readonly changeType: WeatherNotificationChangeType;
    readonly category: NotificationCategory;
    readonly definitionId: NotificationMessageDefinitionId;
    readonly occurredAt: UtcIso8601String;
    readonly detail?: string;
    readonly phenomenonKey: WarningPhenomenonKey | null;
  }): boolean {
    const notification: WeatherNotification = {
      notificationId: notificationIdFactory(),
      category: params.category,
      origin: 'weather',
      changeType: params.changeType,
      sourceType: 'warning_current',
      sourceVersion: context.sourceVersion,
      targets: [target],
      occurredAt: params.occurredAt,
      detectedAt: context.detectedAt,
      relatedRefs,
      detectionContext,
      isTraining,
    };

    try {
      const output = resolveNotificationMessage(notification, {
        definitionId: params.definitionId,
        detail: params.detail,
      });
      notifications.push({ notification, output });
      return true;
    } catch (err: unknown) {
      skipped.push({
        phenomenonKey: params.phenomenonKey,
        changeType: params.changeType,
        reason: 'message_resolution_failed',
        detail: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  // --- Case 1: 取消電文 ---
  if (trigger.kind === 'reception' && trigger.infoType === '取消') {
    for (const change of changes) {
      if (change.changeType === 'continued') {
        skipped.push({
          phenomenonKey: change.phenomenonKey,
          changeType: 'continued',
          reason: 'continued',
          detail: '同一内容の継続',
        });
      } else if (change.changeType === 'released') {
        // §4.6.2: 取消電文由来の released を cancelled として通知。固定 warning。
        const definitionId = selectWarningNotificationDefinitionId('cancelled', null);
        if (!definitionId) {
          skipped.push({
            phenomenonKey: change.phenomenonKey,
            changeType: 'cancelled',
            reason: 'unmapped_definition',
            detail: 'cancelled definition not found',
          });
          continue;
        }

        tryCreateNotification({
          changeType: 'cancelled',
          category: 'warning',
          definitionId,
          occurredAt: context.reportDateTime,
          detail: change.before?.kindName ?? undefined,
          phenomenonKey: change.phenomenonKey,
        });
      } else {
        // 取消電文で new / strengthened / weakened はありえない（本文解釈しないため）
        skipped.push({
          phenomenonKey: change.phenomenonKey,
          changeType: change.changeType,
          reason: 'unexpected_change_on_cancel',
          detail: `取消電文で予期しない状態変化: ${change.changeType}`,
        });
      }
    }
    return { notifications, skipped };
  }

  // --- Case 2: 訂正電文 ---
  if (trigger.kind === 'reception' && trigger.infoType === '訂正') {
    for (const change of changes) {
      if (
        change.changeType === 'new' ||
        change.changeType === 'strengthened' ||
        change.changeType === 'weakened' ||
        change.changeType === 'released'
      ) {
        // 通常ルールで通知
        planSingleStandardChange(change, context, tryCreateNotification, skipped);
      } else if (change.changeType === 'continued') {
        // 訂正後スナップショットで sourceTelegram が当該電文種別と一致するアイテムを探す
        const matchingItem = context.currentItems.find(
          (item) =>
            WARNING_CODE_TABLE[item.kindCode]?.phenomenonKey === change.phenomenonKey &&
            (trigger.telegramType === 'VPWS50' || item.sourceTelegram === trigger.telegramType),
        );

        if (matchingItem) {
          const classification = classifyWarningNotificationCategory(matchingItem.kindCode);
          if (classification.kind !== 'classified') {
            skipped.push({
              phenomenonKey: change.phenomenonKey,
              changeType: 'corrected',
              reason: 'unclassifiable_kind_code',
              detail: `訂正アイテムの区分判定不能: ${matchingItem.kindCode}`,
            });
            continue;
          }

          const definitionId = selectWarningNotificationDefinitionId('corrected', null);
          if (!definitionId) {
            skipped.push({
              phenomenonKey: change.phenomenonKey,
              changeType: 'corrected',
              reason: 'unmapped_definition',
              detail: 'corrected definition not found',
            });
            continue;
          }

          tryCreateNotification({
            changeType: 'corrected',
            category: classification.category,
            definitionId,
            occurredAt: matchingItem.kindIssuedAt ?? context.reportDateTime,
            detail: matchingItem.kindName,
            phenomenonKey: change.phenomenonKey,
          });
        } else {
          skipped.push({
            phenomenonKey: change.phenomenonKey,
            changeType: 'continued',
            reason: 'continued',
            detail: '同一内容の継続（訂正対象外ストリーム）',
          });
        }
      }
    }

    // 1・2 のいずれでも 1 件も生成されなかった場合（例: 訂正後の現況が「発表警報・注意報はなし」）
    if (notifications.length === 0) {
      const definitionId = selectWarningNotificationDefinitionId('corrected', null);
      if (definitionId) {
        tryCreateNotification({
          changeType: 'corrected',
          category: 'warning',
          definitionId,
          occurredAt: context.reportDateTime,
          detail: undefined,
          phenomenonKey: null,
        });
      }
    }

    return { notifications, skipped };
  }

  // --- Case 3: 通常発表 または 初期取得 ---
  for (const change of changes) {
    if (change.changeType === 'continued') {
      skipped.push({
        phenomenonKey: change.phenomenonKey,
        changeType: change.changeType,
        reason: 'continued',
        detail: '同一内容の継続',
      });
    } else {
      planSingleStandardChange(change, context, tryCreateNotification, skipped);
    }
  }

  return { notifications, skipped };
}

function planSingleStandardChange(
  change: WarningCurrentChange,
  context: WarningNotificationContext,
  tryCreateNotification: (params: {
    readonly changeType: WeatherNotificationChangeType;
    readonly category: NotificationCategory;
    readonly definitionId: NotificationMessageDefinitionId;
    readonly occurredAt: UtcIso8601String;
    readonly detail?: string;
    readonly phenomenonKey: WarningPhenomenonKey | null;
  }) => boolean,
  skipped: WarningNotificationSkip[],
): void {
  if (change.changeType === 'new') {
    if (!change.after) {
      skipped.push({
        phenomenonKey: change.phenomenonKey,
        changeType: 'new',
        reason: 'unclassifiable_kind_code',
        detail: 'new change must have non-null after',
      });
      return;
    }

    const classification = classifyWarningNotificationCategory(change.after.kindCode);
    if (classification.kind !== 'classified') {
      skipped.push({
        phenomenonKey: change.phenomenonKey,
        changeType: 'new',
        reason: 'unclassifiable_kind_code',
        detail: `区分判定不能なコード: ${change.after.kindCode}`,
      });
      return;
    }

    const definitionId = selectIssuedNotificationDefinitionId(change.after.kindCode);
    if (!definitionId) {
      skipped.push({
        phenomenonKey: change.phenomenonKey,
        changeType: 'new',
        reason: 'unmapped_definition',
        detail: `定義ID未対応: ${change.after.kindCode}`,
      });
      return;
    }

    tryCreateNotification({
      changeType: 'new',
      category: classification.category,
      definitionId,
      occurredAt: change.after.kindIssuedAt ?? context.reportDateTime,
      detail: change.after.kindName,
      phenomenonKey: change.phenomenonKey,
    });
    return;
  }

  if (
    change.changeType === 'strengthened' ||
    change.changeType === 'weakened' ||
    change.changeType === 'released'
  ) {
    if (!isWarningStateChangeDecisionInput(change)) {
      skipped.push({
        phenomenonKey: change.phenomenonKey,
        changeType: change.changeType,
        reason: 'state_change_decision_failed',
        detail: 'malformed state change input',
      });
      return;
    }

    let decision;
    try {
      decision = decideWarningStateChangeNotification(change);
    } catch (err: unknown) {
      skipped.push({
        phenomenonKey: change.phenomenonKey,
        changeType: change.changeType,
        reason: 'state_change_decision_failed',
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const definitionId = selectWarningNotificationDefinitionId(change.changeType, null);
    if (!definitionId) {
      skipped.push({
        phenomenonKey: change.phenomenonKey,
        changeType: change.changeType,
        reason: 'unmapped_definition',
        detail: `${change.changeType} definition not found`,
      });
      return;
    }

    const occurredAt =
      change.changeType === 'released'
        ? context.reportDateTime
        : (change.after?.kindIssuedAt ?? context.reportDateTime);

    const detail =
      change.changeType === 'released'
        ? (change.before?.kindName ?? undefined)
        : (change.after?.kindName ?? undefined);

    tryCreateNotification({
      changeType: change.changeType,
      category: decision.category,
      definitionId,
      occurredAt,
      detail,
      phenomenonKey: change.phenomenonKey,
    });
  }
}
