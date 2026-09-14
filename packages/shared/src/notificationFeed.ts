import type {
  NotificationCategory,
  NotificationDetectionContext,
  NotificationDisplayMessage,
  NotificationMessageDefinitionRef,
  NotificationOrigin,
  NotificationRelatedRef,
  NotificationTarget,
} from './notification.js';
import type { NotificationDeltaItem, NotificationDeltaVenueScope } from './notificationDelta.js';
import type { StartupCurrentNotification } from './startupNotification.js';
import type { UtcIso8601String } from './types.js';

export type NotificationFeedSource = 'startup' | 'delta';

export interface NotificationFeedItem {
  /** `startup:<outputId>` または `delta:<notificationId>`。ID空間の混同を型で防ぐ。 */
  readonly feedKey: string;
  readonly source: NotificationFeedSource;
  /** delta のみ。startup（現況再提示）は null。 */
  readonly sequence: number | null;
  readonly category: NotificationCategory;
  readonly origin: NotificationOrigin;
  /** startup 応答は detectionContext を持たないので null。捏造しない（#145 §7）。 */
  readonly detectionContext: NotificationDetectionContext | null;
  /** startup 応答は changeType を持たないので null。 */
  readonly changeType: string | null;
  readonly sourceType: string;
  readonly sourceVersion: string | null;
  readonly targets: readonly [NotificationTarget, ...NotificationTarget[]];
  readonly occurredAt: UtcIso8601String;
  /** startup 応答は detectedAt を持たないので null。 */
  readonly detectedAt: UtcIso8601String | null;
  readonly relatedRefs: readonly NotificationRelatedRef[];
  readonly isTraining: boolean;
  readonly ackRequired: boolean;
  readonly summary: string;
  /**
   * startup のみ 3 要素を持つ。delta は null（B4 に個別値がない）。
   * 監査・将来利用のために運ぶだけであり、H 側の通知表示には使わない。
   * 表示は startup / delta ともに `summary` を 1 本のまま用いる（確定事項7）。
   */
  readonly display: NotificationDisplayMessage | null;
  readonly messageDefinition: NotificationMessageDefinitionRef | null;
  readonly venueScope: NotificationDeltaVenueScope | null;
}

export function toNotificationFeedItemFromStartup(
  n: StartupCurrentNotification,
): NotificationFeedItem {
  return {
    feedKey: `startup:${n.outputId}`,
    source: 'startup',
    sequence: null,
    category: n.category,
    origin: n.origin,
    detectionContext: null,
    changeType: null,
    sourceType: n.sourceType,
    sourceVersion: n.sourceVersion,
    targets: n.targets,
    occurredAt: n.occurredAt,
    detectedAt: null,
    relatedRefs: n.relatedRefs,
    isTraining: n.isTraining,
    ackRequired: n.output.ackRequired,
    summary: n.output.summary,
    display: n.output.display,
    messageDefinition: n.output.messageDefinition,
    venueScope: null,
  };
}

export function toNotificationFeedItemFromDelta(item: NotificationDeltaItem): NotificationFeedItem {
  return {
    feedKey: `delta:${item.notificationId}`,
    source: 'delta',
    sequence: item.sequence,
    category: item.category,
    origin: item.origin,
    detectionContext: item.detectionContext,
    changeType: item.changeType,
    sourceType: item.sourceType,
    sourceVersion: item.sourceVersion,
    targets: item.targets,
    occurredAt: item.occurredAt,
    detectedAt: item.detectedAt,
    relatedRefs: item.relatedRefs,
    isTraining: item.isTraining,
    ackRequired: item.output.ackRequired,
    summary: item.output.summary,
    display: null,
    messageDefinition: item.output.messageDefinition,
    venueScope: item.venueScope,
  };
}

/**
 * feedKey で重複排除し、occurredAt → sequence（null 最後）→ feedKey の昇順で安定整列する。
 */
export function mergeNotificationFeedItems(
  existing: readonly NotificationFeedItem[],
  incoming: readonly NotificationFeedItem[],
): readonly NotificationFeedItem[] {
  const map = new Map<string, NotificationFeedItem>();
  for (const item of existing) {
    map.set(item.feedKey, item);
  }
  for (const item of incoming) {
    map.set(item.feedKey, item);
  }
  const merged = Array.from(map.values());
  return merged.sort((a, b) => {
    if (a.occurredAt !== b.occurredAt) {
      return a.occurredAt.localeCompare(b.occurredAt);
    }
    if (a.sequence !== b.sequence) {
      if (a.sequence === null) return 1;
      if (b.sequence === null) return -1;
      return a.sequence - b.sequence;
    }
    return a.feedKey.localeCompare(b.feedKey);
  });
}
