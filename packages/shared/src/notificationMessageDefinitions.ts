import type {
  Notification,
  NotificationAction,
  NotificationCategory,
  NotificationOrigin,
  ResolvedNotificationOutputSnapshot,
  WeatherNotificationChangeType,
} from './notification.js';

export type NotificationMessageDefinitionId =
  | 'weather-advisory-issued'
  | 'weather-warning-issued'
  | 'weather-special-warning-issued'
  | 'weather-warning-strengthened'
  | 'weather-warning-weakened'
  | 'weather-warning-released'
  | 'weather-warning-corrected'
  | 'weather-warning-cancelled'
  | 'weather-bosai-bulletin-linear-rainband-observed'
  | 'weather-bosai-bulletin-linear-rainband-forecast'
  | 'weather-bosai-bulletin-record-short-rain'
  | 'weather-bosai-bulletin-tornado-warning'
  | 'weather-bosai-bulletin-tornado-sighting'
  | 'system-data-fetch-delayed'
  | 'system-data-fetch-failed'
  | 'system-database-initialized'
  | 'system-database-initialization-failed'
  | 'system-service-stopped'
  | 'system-operation-mode-changed'
  | 'system-fetch-manually-stopped'
  | 'system-fetch-manually-started'
  | 'system-force-fetch-completed'
  | 'system-force-fetch-failed';

export interface ResolveNotificationMessageInput {
  readonly definitionId: NotificationMessageDefinitionId;
  readonly detail?: string;
  readonly omitTarget?: boolean;
}

export type NotificationMessageResolutionErrorCode =
  | 'definition_not_found'
  | 'notification_mismatch'
  | 'invalid_detail'
  | 'target_omission_not_allowed'
  | 'invalid_target_name';

export class NotificationMessageResolutionError extends Error {
  readonly code: NotificationMessageResolutionErrorCode;
  readonly definitionId: string;

  constructor(
    code: NotificationMessageResolutionErrorCode,
    definitionId: string,
    message?: string,
  ) {
    super(message ?? `Notification message resolution failed with code: ${code}`);
    this.name = 'NotificationMessageResolutionError';
    this.code = code;
    this.definitionId = definitionId;
  }
}

type TargetMode =
  | { readonly kind: 'notificationTargets' }
  | { readonly kind: 'notificationTargetsOmittable' }
  | { readonly kind: 'fixed'; readonly fixedTarget: string };

type ActionResolution =
  { readonly kind: 'none' } | { readonly kind: 'acknowledge' } | { readonly kind: 'byCategory' };

interface MessageDefinitionInternal {
  readonly id: NotificationMessageDefinitionId;
  readonly version: '1';
  readonly origin: NotificationOrigin;
  readonly allowedCategories: readonly NotificationCategory[];
  readonly requiredWeatherChangeType?: WeatherNotificationChangeType;
  readonly title: string;
  readonly targetMode: TargetMode;
  readonly fixedContent?: string;
  readonly actionResolution: ActionResolution;
}

const MESSAGE_DEFINITIONS = {
  // --- 気象通知 (11種) ---
  'weather-advisory-issued': {
    id: 'weather-advisory-issued',
    version: '1',
    origin: 'weather',
    allowedCategories: ['warning', 'question'],
    requiredWeatherChangeType: 'new',
    title: '気象注意報発表',
    targetMode: { kind: 'notificationTargets' },
    actionResolution: { kind: 'byCategory' },
  },
  'weather-warning-issued': {
    id: 'weather-warning-issued',
    version: '1',
    origin: 'weather',
    allowedCategories: ['question', 'emergency'],
    requiredWeatherChangeType: 'new',
    title: '気象警報発表',
    targetMode: { kind: 'notificationTargets' },
    actionResolution: { kind: 'byCategory' },
  },
  'weather-special-warning-issued': {
    id: 'weather-special-warning-issued',
    version: '1',
    origin: 'weather',
    allowedCategories: ['emergency'],
    requiredWeatherChangeType: 'new',
    title: '気象特別警報発表',
    targetMode: { kind: 'notificationTargets' },
    actionResolution: { kind: 'acknowledge' },
  },
  'weather-warning-strengthened': {
    id: 'weather-warning-strengthened',
    version: '1',
    origin: 'weather',
    allowedCategories: ['warning', 'question', 'emergency'],
    requiredWeatherChangeType: 'strengthened',
    title: '気象警報等強化',
    targetMode: { kind: 'notificationTargets' },
    actionResolution: { kind: 'byCategory' },
  },
  'weather-warning-weakened': {
    id: 'weather-warning-weakened',
    version: '1',
    origin: 'weather',
    allowedCategories: ['warning', 'question', 'emergency'],
    requiredWeatherChangeType: 'weakened',
    title: '気象警報等緩和',
    targetMode: { kind: 'notificationTargets' },
    actionResolution: { kind: 'byCategory' },
  },
  'weather-warning-released': {
    id: 'weather-warning-released',
    version: '1',
    origin: 'weather',
    allowedCategories: ['warning'],
    requiredWeatherChangeType: 'released',
    title: '気象警報等解除',
    targetMode: { kind: 'notificationTargets' },
    actionResolution: { kind: 'none' },
  },
  'weather-warning-corrected': {
    id: 'weather-warning-corrected',
    version: '1',
    origin: 'weather',
    allowedCategories: ['warning', 'question', 'emergency'],
    requiredWeatherChangeType: 'corrected',
    title: '気象警報等訂正',
    targetMode: { kind: 'notificationTargets' },
    actionResolution: { kind: 'byCategory' },
  },
  'weather-warning-cancelled': {
    id: 'weather-warning-cancelled',
    version: '1',
    origin: 'weather',
    allowedCategories: ['warning'],
    requiredWeatherChangeType: 'cancelled',
    title: '気象警報等取消',
    targetMode: { kind: 'notificationTargets' },
    actionResolution: { kind: 'none' },
  },
  'weather-bosai-bulletin-linear-rainband-observed': {
    id: 'weather-bosai-bulletin-linear-rainband-observed',
    version: '1',
    origin: 'weather',
    allowedCategories: ['question'],
    requiredWeatherChangeType: 'new',
    title: '気象防災速報発表',
    targetMode: { kind: 'notificationTargets' },
    fixedContent: '線状降水帯発生',
    actionResolution: { kind: 'acknowledge' },
  },
  'weather-bosai-bulletin-linear-rainband-forecast': {
    id: 'weather-bosai-bulletin-linear-rainband-forecast',
    version: '1',
    origin: 'weather',
    allowedCategories: ['question'],
    requiredWeatherChangeType: 'new',
    title: '気象防災速報発表',
    targetMode: { kind: 'notificationTargets' },
    fixedContent: '線状降水帯直前予測',
    actionResolution: { kind: 'acknowledge' },
  },
  'weather-bosai-bulletin-record-short-rain': {
    id: 'weather-bosai-bulletin-record-short-rain',
    version: '1',
    origin: 'weather',
    allowedCategories: ['question'],
    requiredWeatherChangeType: 'new',
    title: '気象防災速報発表',
    targetMode: { kind: 'notificationTargets' },
    fixedContent: '記録的短時間大雨',
    actionResolution: { kind: 'acknowledge' },
  },
  'weather-bosai-bulletin-tornado-warning': {
    id: 'weather-bosai-bulletin-tornado-warning',
    version: '1',
    origin: 'weather',
    allowedCategories: ['question'],
    requiredWeatherChangeType: 'new',
    title: '気象防災速報発表',
    targetMode: { kind: 'notificationTargets' },
    fixedContent: '竜巻注意',
    actionResolution: { kind: 'acknowledge' },
  },
  'weather-bosai-bulletin-tornado-sighting': {
    id: 'weather-bosai-bulletin-tornado-sighting',
    version: '1',
    origin: 'weather',
    allowedCategories: ['question'],
    requiredWeatherChangeType: 'new',
    title: '気象防災速報発表',
    targetMode: { kind: 'notificationTargets' },
    fixedContent: '竜巻目撃',
    actionResolution: { kind: 'acknowledge' },
  },

  // --- システム通知 (10種) ---
  'system-data-fetch-delayed': {
    id: 'system-data-fetch-delayed',
    version: '1',
    origin: 'system',
    allowedCategories: ['warning'],
    title: 'データ取得遅延',
    targetMode: { kind: 'notificationTargets' },
    actionResolution: { kind: 'none' },
  },
  'system-data-fetch-failed': {
    id: 'system-data-fetch-failed',
    version: '1',
    origin: 'system',
    allowedCategories: ['question'],
    title: 'データ取得異常',
    targetMode: { kind: 'notificationTargets' },
    actionResolution: { kind: 'acknowledge' },
  },
  'system-database-initialized': {
    id: 'system-database-initialized',
    version: '1',
    origin: 'system',
    allowedCategories: ['warning'],
    title: 'DB初期化完了',
    targetMode: { kind: 'notificationTargetsOmittable' },
    actionResolution: { kind: 'none' },
  },
  'system-database-initialization-failed': {
    id: 'system-database-initialization-failed',
    version: '1',
    origin: 'system',
    allowedCategories: ['question'],
    title: 'DB初期化異常終了',
    targetMode: { kind: 'notificationTargets' },
    actionResolution: { kind: 'acknowledge' },
  },
  'system-service-stopped': {
    id: 'system-service-stopped',
    version: '1',
    origin: 'system',
    allowedCategories: ['question'],
    title: 'サービス停止',
    targetMode: { kind: 'fixed', fixedTarget: '防災気象情報' },
    actionResolution: { kind: 'acknowledge' },
  },
  'system-operation-mode-changed': {
    id: 'system-operation-mode-changed',
    version: '1',
    origin: 'system',
    allowedCategories: ['warning'],
    title: '運転モード切替',
    targetMode: { kind: 'fixed', fixedTarget: '防災気象情報' },
    actionResolution: { kind: 'none' },
  },
  'system-fetch-manually-stopped': {
    id: 'system-fetch-manually-stopped',
    version: '1',
    origin: 'system',
    allowedCategories: ['warning'],
    title: '取得手動停止',
    targetMode: { kind: 'notificationTargetsOmittable' },
    actionResolution: { kind: 'none' },
  },
  'system-fetch-manually-started': {
    id: 'system-fetch-manually-started',
    version: '1',
    origin: 'system',
    allowedCategories: ['warning'],
    title: '取得手動開始',
    targetMode: { kind: 'notificationTargetsOmittable' },
    actionResolution: { kind: 'none' },
  },
  'system-force-fetch-completed': {
    id: 'system-force-fetch-completed',
    version: '1',
    origin: 'system',
    allowedCategories: ['warning'],
    title: '強制取得完了',
    targetMode: { kind: 'notificationTargetsOmittable' },
    actionResolution: { kind: 'none' },
  },
  'system-force-fetch-failed': {
    id: 'system-force-fetch-failed',
    version: '1',
    origin: 'system',
    allowedCategories: ['question'],
    title: '強制取得失敗',
    targetMode: { kind: 'notificationTargets' },
    actionResolution: { kind: 'acknowledge' },
  },
} as const satisfies Record<NotificationMessageDefinitionId, MessageDefinitionInternal>;

export function resolveNotificationMessage(
  notification: Notification,
  input: ResolveNotificationMessageInput,
): ResolvedNotificationOutputSnapshot {
  const definition = (MESSAGE_DEFINITIONS as Record<string, MessageDefinitionInternal | undefined>)[
    input.definitionId
  ];

  if (!definition) {
    throw new NotificationMessageResolutionError('definition_not_found', input.definitionId);
  }

  // 1. notification と definition の整合性チェック
  if (notification.origin !== definition.origin) {
    throw new NotificationMessageResolutionError('notification_mismatch', input.definitionId);
  }

  if (!definition.allowedCategories.includes(notification.category)) {
    throw new NotificationMessageResolutionError('notification_mismatch', input.definitionId);
  }

  if (
    definition.origin === 'weather' &&
    definition.requiredWeatherChangeType !== undefined &&
    notification.origin === 'weather' &&
    notification.changeType !== definition.requiredWeatherChangeType
  ) {
    throw new NotificationMessageResolutionError('notification_mismatch', input.definitionId);
  }

  // 2. omitTarget のチェック
  if (input.omitTarget === true) {
    if (definition.targetMode.kind !== 'notificationTargetsOmittable') {
      throw new NotificationMessageResolutionError(
        'target_omission_not_allowed',
        input.definitionId,
      );
    }
  }

  // 3. detail の検証
  if (input.detail !== undefined) {
    if (
      input.detail.includes('\r') ||
      input.detail.includes('\n') ||
      input.detail.trim().length === 0
    ) {
      throw new NotificationMessageResolutionError('invalid_detail', input.definitionId);
    }
  }

  // 4. target の生成と検証
  let target: string | null = null;
  if (definition.targetMode.kind === 'fixed') {
    target = definition.targetMode.fixedTarget;
  } else if (
    definition.targetMode.kind === 'notificationTargetsOmittable' &&
    input.omitTarget === true
  ) {
    target = null;
  } else {
    for (const t of notification.targets) {
      if (t.name.includes('\r') || t.name.includes('\n') || t.name.trim().length === 0) {
        throw new NotificationMessageResolutionError('invalid_target_name', input.definitionId);
      }
    }
    target = notification.targets.map((t) => t.name).join('、');
  }

  // 5. content の生成
  let content: string | null = null;
  if (definition.fixedContent !== undefined && input.detail !== undefined) {
    content = `${definition.fixedContent}：${input.detail}`;
  } else if (definition.fixedContent !== undefined) {
    content = definition.fixedContent;
  } else if (input.detail !== undefined) {
    content = input.detail;
  }

  // 6. action と ackRequired の決定
  let action: NotificationAction = null;
  let ackRequired = false;

  if (definition.actionResolution.kind === 'acknowledge') {
    action = { kind: 'acknowledge', label: '確認' };
    ackRequired = true;
  } else if (definition.actionResolution.kind === 'byCategory') {
    if (notification.category === 'warning') {
      action = null;
      ackRequired = false;
    } else {
      action = { kind: 'acknowledge', label: '確認' };
      ackRequired = true;
    }
  }

  // 7. summary の生成
  const summaryParts: string[] = [definition.title];
  if (target !== null) {
    summaryParts.push(target);
  }
  if (content !== null) {
    summaryParts.push(content);
  }
  const summary = summaryParts.join('\n');

  return {
    ackRequired,
    summary,
    messageDefinition: {
      id: definition.id,
      version: definition.version,
    },
    display: {
      title: definition.title,
      target,
      content,
    },
    action,
  };
}
