import type { UtcIso8601String } from './types.js';

export type NotificationCategory = 'warning' | 'question' | 'emergency';
export type NotificationOrigin = 'weather' | 'system';
export type NotificationDetectionContext = 'normal' | 'initial';

export type WeatherNotificationChangeType =
  'new' | 'continued' | 'strengthened' | 'weakened' | 'released' | 'corrected' | 'cancelled';

/** 装置異常の状態値は D2 以降で確定するため、D1 では非空文字列として扱う。 */
export type SystemNotificationChangeType = string;

export interface NotificationTarget {
  readonly kind: 'area' | 'point' | 'equipment';
  /** 同じ code でも意味が混ざらないよう、コード体系を表す。 */
  readonly codeType: string;
  readonly code: string;
  readonly name: string;
}

export interface NotificationRelatedRef {
  readonly type: string;
  readonly ref: string;
}

export interface NotificationMessageDefinitionRef {
  readonly id: string;
  readonly version: string;
}

interface NotificationBase {
  readonly notificationId: string;
  readonly category: NotificationCategory;
  readonly sourceType: string;
  readonly sourceVersion: string | null;
  /** 発生対象。空配列は許可しない。 */
  readonly targets: readonly [NotificationTarget, ...NotificationTarget[]];
  readonly occurredAt: UtcIso8601String;
  readonly detectedAt: UtcIso8601String;
  readonly relatedRefs: readonly NotificationRelatedRef[];
  readonly detectionContext: NotificationDetectionContext;
  readonly isTraining: boolean;
}

export interface WeatherNotification extends NotificationBase {
  readonly origin: 'weather';
  readonly changeType: WeatherNotificationChangeType;
}

export interface SystemNotification extends NotificationBase {
  readonly origin: 'system';
  readonly changeType: SystemNotificationChangeType;
}

export type Notification = WeatherNotification | SystemNotification;

/** #103 が通知事実から選ぶ出力スナップショット。D1 は選択規則を所有しない。 */
export interface NotificationOutputSnapshot {
  readonly ackRequired: boolean;
  readonly summary: string;
  readonly messageDefinition: NotificationMessageDefinitionRef | null;
}

export interface NotificationDisplayMessage {
  readonly title: string;
  readonly target: string | null;
  readonly content: string | null;
}

export interface NotificationAcknowledgeAction {
  readonly kind: 'acknowledge';
  readonly label: '確認';
}

export type NotificationAction = NotificationAcknowledgeAction | null;

export interface ResolvedNotificationOutputSnapshot extends NotificationOutputSnapshot {
  readonly messageDefinition: NotificationMessageDefinitionRef;
  readonly display: NotificationDisplayMessage;
  readonly action: NotificationAction;
}
