import type {
  ResolvedNotificationOutputSnapshot,
  SystemNotification,
  UtcIso8601String,
} from '@wx-viewer-poc/shared';
import {
  resolveNotificationMessage,
  type NotificationMessageDefinitionId,
} from '@wx-viewer-poc/shared';
import type { MonitoredFetchSourceId } from '../monitoring/fetchHealthSources.js';
import { MONITORED_FETCH_SOURCES } from '../monitoring/fetchHealthSources.js';
import type {
  FetchHealthAggregate,
  FetchHealthStatus,
  FetchSourceHealthResult,
} from '../monitoring/fetchHealthEvaluator.js';

/**
 * D7 が確定させる装置異常系（取得健全性）の changeType 値集合。
 * SystemNotificationChangeType（= string、D1 が意図的に開いた契約）に代入可能な部分集合として定義する。
 * shared 側の型は狭めない。
 */
export type FetchHealthNotificationChangeType =
  | 'fetch_delayed' // 遅延判定に該当（悪化からの回復 abnormal→delayed を含む）
  | 'fetch_abnormal' // 異常判定に該当
  | 'fetch_recovered'; // 正常復帰

export interface PlannedFetchHealthNotification {
  /** この通知がどの取得元に由来するか。emitter がログ・commit の対応づけに使う。 */
  readonly sourceId: MonitoredFetchSourceId;
  readonly notification: SystemNotification;
  readonly output: ResolvedNotificationOutputSnapshot;
}

export type FetchHealthNotificationSkipReason =
  'unchanged' | 'initial_no_problem' | 'suspended_transition' | 'message_resolution_failed';

export interface FetchHealthNotificationSkip {
  /** どの取得元について見送ったか。 */
  readonly sourceId: MonitoredFetchSourceId;
  readonly reason: FetchHealthNotificationSkipReason;
  readonly detail: string;
}

export interface PlanFetchHealthNotificationInput {
  /**
   * 取得元ごとの前回状態。プロセス起動後まだ評価していない取得元は null。
   * 全 MonitoredFetchSourceId を鍵に持つ（値が null でも鍵は存在する）。
   */
  readonly previousStatusBySource: Readonly<
    Record<MonitoredFetchSourceId, FetchHealthStatus | null>
  >;
  /** 今回の評価結果。sources の各要素が独立に判定される。 */
  readonly current: FetchHealthAggregate;
  readonly detectedAt: UtcIso8601String;
  readonly notificationIdFactory: () => string;
}

export interface FetchHealthNotificationPlan {
  /** 状態が変化した取得元の数だけ並ぶ（0〜6 件）。順序は MONITORED_FETCH_SOURCES の順。 */
  readonly notifications: readonly PlannedFetchHealthNotification[];
  /** 通知しなかった取得元の理由。取得元ごとに 1 件。 */
  readonly skipped: readonly FetchHealthNotificationSkip[];
}

interface TransitionDecision {
  readonly shouldNotify: boolean;
  readonly changeType?: FetchHealthNotificationChangeType;
  readonly skipReason?: FetchHealthNotificationSkipReason;
  readonly skipDetail?: string;
}

function decideTransition(
  previousStatus: FetchHealthStatus | null,
  currentStatus: FetchHealthStatus,
): TransitionDecision {
  // 同一状態
  if (previousStatus === currentStatus) {
    return {
      shouldNotify: false,
      skipReason: 'unchanged',
      skipDetail: `状態変更なし: ${currentStatus}`,
    };
  }

  // 起動直後 (previousStatus === null)
  if (previousStatus === null) {
    if (currentStatus === 'normal' || currentStatus === 'suspended') {
      return {
        shouldNotify: false,
        skipReason: 'initial_no_problem',
        skipDetail: `初期評価で問題なし (${currentStatus})`,
      };
    }
    if (currentStatus === 'delayed') {
      return { shouldNotify: true, changeType: 'fetch_delayed' };
    }
    if (currentStatus === 'abnormal') {
      return { shouldNotify: true, changeType: 'fetch_abnormal' };
    }
  }

  // normal / suspended -> delayed
  if (
    (previousStatus === 'normal' || previousStatus === 'suspended') &&
    currentStatus === 'delayed'
  ) {
    return { shouldNotify: true, changeType: 'fetch_delayed' };
  }

  // normal / suspended -> abnormal
  if (
    (previousStatus === 'normal' || previousStatus === 'suspended') &&
    currentStatus === 'abnormal'
  ) {
    return { shouldNotify: true, changeType: 'fetch_abnormal' };
  }

  // delayed -> abnormal (悪化)
  if (previousStatus === 'delayed' && currentStatus === 'abnormal') {
    return { shouldNotify: true, changeType: 'fetch_abnormal' };
  }

  // abnormal -> delayed (回復)
  if (previousStatus === 'abnormal' && currentStatus === 'delayed') {
    return { shouldNotify: true, changeType: 'fetch_delayed' };
  }

  // delayed / abnormal -> normal (正常復帰)
  if (
    (previousStatus === 'delayed' || previousStatus === 'abnormal') &&
    currentStatus === 'normal'
  ) {
    return { shouldNotify: true, changeType: 'fetch_recovered' };
  }

  // delayed / abnormal -> suspended, normal -> suspended, suspended -> normal
  if (
    currentStatus === 'suspended' ||
    (previousStatus === 'suspended' && currentStatus === 'normal')
  ) {
    return {
      shouldNotify: false,
      skipReason: 'suspended_transition',
      skipDetail: `停止状態への遷移または停止からの復帰 (${previousStatus} -> ${currentStatus})`,
    };
  }

  return {
    shouldNotify: false,
    skipReason: 'unchanged',
    skipDetail: `未定義の遷移: ${previousStatus} -> ${currentStatus}`,
  };
}

export function planFetchHealthNotification(
  input: PlanFetchHealthNotificationInput,
): FetchHealthNotificationPlan {
  const notifications: PlannedFetchHealthNotification[] = [];
  const skipped: FetchHealthNotificationSkip[] = [];

  const currentResultMap = new Map<MonitoredFetchSourceId, FetchSourceHealthResult>();
  for (const sourceResult of input.current.sources) {
    currentResultMap.set(sourceResult.sourceId, sourceResult);
  }

  for (const sourceDef of MONITORED_FETCH_SOURCES) {
    const sourceId = sourceDef.id;
    const previousStatus = input.previousStatusBySource[sourceId] ?? null;
    const currentResult = currentResultMap.get(sourceId);

    if (!currentResult) {
      skipped.push({
        sourceId,
        reason: 'unchanged',
        detail: '取得元結果が存在しません',
      });
      continue;
    }

    const currentStatus = currentResult.status;
    const decision = decideTransition(previousStatus, currentStatus);

    if (!decision.shouldNotify || !decision.changeType) {
      skipped.push({
        sourceId,
        reason: decision.skipReason ?? 'unchanged',
        detail: decision.skipDetail ?? '',
      });
      continue;
    }

    const changeType = decision.changeType;
    const category = currentStatus === 'abnormal' ? 'question' : 'warning';
    const detectionContext = previousStatus === null ? 'initial' : 'normal';

    const notification: SystemNotification = {
      notificationId: input.notificationIdFactory(),
      origin: 'system',
      category,
      changeType,
      sourceType: 'fetch_health',
      sourceVersion: null,
      targets: [
        {
          kind: 'equipment',
          codeType: 'wx-viewer-poc/fetch-source',
          code: sourceDef.id,
          name: sourceDef.displayName,
        },
      ],
      occurredAt: input.detectedAt,
      detectedAt: input.detectedAt,
      relatedRefs: [{ type: 'fetch_source', ref: sourceDef.id }],
      detectionContext,
      isTraining: false,
    };

    let definitionId: NotificationMessageDefinitionId;
    let detail: string | undefined;

    if (changeType === 'fetch_delayed') {
      definitionId = 'system-data-fetch-delayed';
      detail = currentResult.reasons[0]?.text ?? sourceDef.displayName;
    } else if (changeType === 'fetch_abnormal') {
      definitionId = 'system-data-fetch-failed';
      detail = currentResult.reasons[0]?.text ?? sourceDef.displayName;
    } else {
      // fetch_recovered
      definitionId = 'system-data-fetch-recovered';
      detail = undefined;
    }

    try {
      const output = resolveNotificationMessage(notification, {
        definitionId,
        detail,
      });

      notifications.push({
        sourceId,
        notification,
        output,
      });
    } catch (error) {
      skipped.push({
        sourceId,
        reason: 'message_resolution_failed',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    notifications,
    skipped,
  };
}
