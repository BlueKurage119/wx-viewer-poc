import type {
  Notification,
  NotificationTarget,
  NotificationOutputSnapshot,
  SystemNotification,
  WeatherNotification,
  WeatherNotificationChangeType,
} from './notification.js';

// --- 型テスト 1: 禁止された端末・配信・画面属性が存在しないことの検証 ---
type AssertNever<T extends never> = T;

type ForbiddenKeys =
  | 'terminalId'
  | 'terminalGroupId'
  | 'read'
  | 'unread'
  | 'isRead'
  | 'confirmed'
  | 'ackStatus'
  | 'delivered'
  | 'deliveryStatus'
  | 'assignedTerminalId'
  | 'soundAssignee'
  | 'summary'
  | 'ackRequired';

type ExtractForbiddenKeys<T> = ForbiddenKeys extends infer K
  ? K extends keyof T
    ? K
    : never
  : never;

type _NotificationHasNoForbiddenKeys = AssertNever<ExtractForbiddenKeys<Notification>>;
void (null as unknown as _NotificationHasNoForbiddenKeys);

declare const notification: Notification;

const target: NotificationTarget = {
  kind: 'equipment',
  codeType: 'system_component',
  code: 'notification-service',
  name: '通知サービス',
};

// @ts-expect-error Notification は端末 ID を持たない
void notification.terminalId;

// @ts-expect-error Notification は端末グループ ID を持たない
void notification.terminalGroupId;

// @ts-expect-error Notification は既読状態を持たない
void notification.read;

// @ts-expect-error Notification は未読状態を持たない
void notification.unread;

// @ts-expect-error Notification は確認状態を持たない
void notification.confirmed;

// @ts-expect-error Notification は配信状態を持たない
void notification.delivered;

// @ts-expect-error Notification は固定の鳴動担当を持たない
void notification.assignedTerminalId;

// @ts-expect-error Notification は文言 summary を持たない（#103 のスナップショットが所有）
void notification.summary;

// @ts-expect-error Notification は ackRequired を持たない（#103 のスナップショットが所有）
void notification.ackRequired;

// --- 型テスト 2: WeatherNotification と SystemNotification の changeType の区別 ---

declare const weatherNotif: WeatherNotification;
declare const systemNotif: SystemNotification;

// weatherNotif.changeType は WeatherNotificationChangeType
const _weatherChangeType: WeatherNotificationChangeType = weatherNotif.changeType;
void _weatherChangeType;
void systemNotif;

const invalidWeatherChangeType: WeatherNotification = {
  notificationId: 'notif-1',
  category: 'warning',
  origin: 'weather',
  // @ts-expect-error 装置異常系の任意文字列は WeatherNotificationChangeType に代入できない
  changeType: 'device_offline',
  sourceType: 'warning_current',
  sourceVersion: 'v1',
  targets: [target],
  occurredAt: '2026-09-12T00:00:00Z',
  detectedAt: '2026-09-12T00:00:01Z',
  relatedRefs: [],
  detectionContext: 'normal',
  isTraining: false,
};
void invalidWeatherChangeType;

// systemNotif は任意の文字列 changeType を許容する
const validSystemNotification: SystemNotification = {
  notificationId: 'notif-2',
  category: 'emergency',
  origin: 'system',
  changeType: 'device_offline',
  sourceType: 'fetch_attempt',
  sourceVersion: null,
  targets: [target],
  occurredAt: '2026-09-12T00:00:00Z',
  detectedAt: '2026-09-12T00:00:01Z',
  relatedRefs: [],
  detectionContext: 'initial',
  isTraining: false,
};
void validSystemNotification;

// @ts-expect-error Notification の targets は空配列を許可しない
const _emptyTargets: SystemNotification = { ...validSystemNotification, targets: [] };
void _emptyTargets;

// @ts-expect-error WeatherNotification に origin: 'system' を代入できない
const _invalidOriginWeather: WeatherNotification = validSystemNotification;
void _invalidOriginWeather;

// @ts-expect-error SystemNotification に origin: 'weather' を代入できない
const _invalidOriginSystem: SystemNotification = weatherNotif;
void _invalidOriginSystem;

// 出力スナップショットの型検証
declare const snapshot: NotificationOutputSnapshot;
const _summary: string = snapshot.summary;
const _ackRequired: boolean = snapshot.ackRequired;
void _summary;
void _ackRequired;
