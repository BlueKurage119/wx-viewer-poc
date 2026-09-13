import {
  resolveNotificationMessage,
  resolveVenueForecastTargets,
  type NotificationDetectionContext,
  type NotificationMessageDefinitionId,
  type NotificationTarget,
  type ResolvedNotificationOutputSnapshot,
  type UtcIso8601String,
  type VenueId,
  type WeatherNotification,
} from '@wx-viewer-poc/shared';
import type { BosaiBulletin, BosaiBulletinAreaInput } from '../repositories/types.js';

export type BosaiNotificationKind =
  | 'linear-rainband-observed'
  | 'linear-rainband-forecast'
  | 'record-short-rain'
  | 'tornado-warning'
  | 'tornado-sighting';

export interface BosaiNotificationPlanInput {
  readonly current: BosaiBulletin;
  readonly previous: BosaiBulletin | null;
  readonly venueId: VenueId;
  readonly detectionContext: NotificationDetectionContext;
  readonly detectedAt: UtcIso8601String;
  readonly notificationIdFactory: () => string;
}

export interface PlannedBosaiBulletinNotification {
  readonly kind: BosaiNotificationKind;
  readonly notification: WeatherNotification;
  readonly output: ResolvedNotificationOutputSnapshot;
}

export interface BosaiNotificationPlanSkip {
  readonly reason: string;
  readonly detail: string;
  readonly eventId?: string;
}

export interface BosaiBulletinNotificationPlan {
  readonly notifications: readonly PlannedBosaiBulletinNotification[];
  readonly skipped: readonly BosaiNotificationPlanSkip[];
}

const VPBS50_TARGET_TAGS = ['線状降水帯発生', '線状降水帯直前', '記録雨'] as const;

const VPBS50_KIND_BY_TAG: Readonly<
  Record<
    string,
    {
      readonly kind: BosaiNotificationKind;
      readonly issuedDefinitionId: NotificationMessageDefinitionId;
      readonly detailText: string;
    }
  >
> = {
  線状降水帯発生: {
    kind: 'linear-rainband-observed',
    issuedDefinitionId: 'weather-bosai-bulletin-linear-rainband-observed',
    detailText: '線状降水帯発生',
  },
  線状降水帯直前: {
    kind: 'linear-rainband-forecast',
    issuedDefinitionId: 'weather-bosai-bulletin-linear-rainband-forecast',
    detailText: '線状降水帯直前予測',
  },
  記録雨: {
    kind: 'record-short-rain',
    issuedDefinitionId: 'weather-bosai-bulletin-record-short-rain',
    detailText: '記録的短時間大雨',
  },
};

export function resolveBosaiBulletinSourceVersion(bulletin: BosaiBulletin): string {
  return JSON.stringify([
    bulletin.eventId,
    bulletin.controlStatus,
    bulletin.controlDateTime,
    bulletin.infoType,
  ]);
}

export function resolveBosaiBulletinExpiresAt(bulletin: BosaiBulletin): UtcIso8601String | null {
  const isVphw =
    bulletin.eventId.startsWith('VPHW50:') ||
    bulletin.eventId.startsWith('VPHW51:') ||
    bulletin.title.includes('竜巻注意情報');

  if (isVphw) {
    return bulletin.metadata.validAt;
  }

  const reportTime = new Date(bulletin.reportDateTime).getTime();
  if (Number.isNaN(reportTime)) {
    return null;
  }
  return new Date(reportTime + 3 * 60 * 60 * 1000).toISOString();
}

function isVphwBulletin(bulletin: BosaiBulletin): boolean {
  return (
    bulletin.eventId.startsWith('VPHW50:') ||
    bulletin.eventId.startsWith('VPHW51:') ||
    bulletin.title.includes('竜巻注意情報')
  );
}

export function planBosaiBulletinNotifications(
  input: BosaiNotificationPlanInput,
): BosaiBulletinNotificationPlan {
  const { current, previous, venueId, detectionContext, detectedAt, notificationIdFactory } = input;

  if (current.controlStatus === 'test') {
    return {
      notifications: [],
      skipped: [
        {
          reason: 'test_control_status',
          detail: 'test controlStatus は通知を生成しません',
        },
      ],
    };
  }

  // 有効期限の検査（通常発表・訂正のみ。取消は期間外でも対象特定できれば通知）
  if (!current.isCancelled) {
    const reportMs = new Date(current.reportDateTime).getTime();
    const nowMs = new Date(detectedAt).getTime();

    if (nowMs < reportMs) {
      return {
        notifications: [],
        skipped: [
          {
            reason: 'future_report_datetime',
            detail: `発表時刻前です (reportDateTime: ${current.reportDateTime}, detectedAt: ${detectedAt})`,
          },
        ],
      };
    }

    const expiresAt = resolveBosaiBulletinExpiresAt(current);
    if (!expiresAt) {
      return {
        notifications: [],
        skipped: [
          {
            reason: 'unknown_expires_at',
            detail: '有効期限が不明です',
          },
        ],
      };
    }

    const expiresMs = new Date(expiresAt).getTime();
    if (nowMs >= expiresMs) {
      return {
        notifications: [],
        skipped: [
          {
            reason: 'expired',
            detail: `有効期限が切れています (expiresAt: ${expiresAt}, detectedAt: ${detectedAt})`,
          },
        ],
      };
    }
  }

  const venueTargets = resolveVenueForecastTargets(venueId);
  const venueIncludedAreaCodes = venueTargets.bosaiBulletin.includedAreaCodes;
  const targetTuple: readonly [NotificationTarget] = [
    {
      kind: 'area',
      codeType: 'venue',
      code: venueId,
      name: venueTargets.venueName,
    },
  ];

  const sourceVersion = resolveBosaiBulletinSourceVersion(current);

  if (isVphwBulletin(current)) {
    if (current.isCancelled) {
      return {
        notifications: [],
        skipped: [
          {
            reason: 'vphw_cancellation_unsupported',
            detail: 'VPHW取消は提供根拠未確認のため通知非採用です',
          },
        ],
      };
    }

    if (current.areas.some((a) => a.informationType === null)) {
      return {
        notifications: [],
        skipped: [
          {
            reason: 'unrecoverable_legacy_areas',
            detail: `旧VPHW区域区分が未復元のため通知から除外します (eventId: ${current.eventId})`,
          },
        ],
      };
    }

    const hasTornadoWarning = current.areas.some(
      (a) =>
        a.informationType !== '竜巻注意情報（目撃情報あり）' &&
        (venueIncludedAreaCodes as readonly string[]).includes(a.areaCode),
    );

    const hasTornadoSighting = current.areas.some(
      (a) =>
        a.informationType === '竜巻注意情報（目撃情報あり）' &&
        (venueIncludedAreaCodes as readonly string[]).includes(a.areaCode),
    );

    if (!hasTornadoWarning && !hasTornadoSighting) {
      return {
        notifications: [],
        skipped: [
          {
            reason: 'outside_venue',
            detail: '会場区域に一致する区域が含まれていません',
          },
        ],
      };
    }

    const planned: PlannedBosaiBulletinNotification[] = [];
    const isCorrected = current.infoType === '訂正';

    if (hasTornadoWarning) {
      const kind: BosaiNotificationKind = 'tornado-warning';
      const notificationId = notificationIdFactory();
      const notification: WeatherNotification = {
        notificationId,
        origin: 'weather',
        category: 'question',
        changeType: isCorrected ? 'corrected' : 'new',
        sourceType: 'bosai_bulletin',
        sourceVersion,
        targets: targetTuple,
        occurredAt: current.reportDateTime,
        detectedAt,
        relatedRefs: [
          { type: 'bosai_bulletin', ref: current.eventId },
          { type: 'venue', ref: venueId },
          { type: 'bosai_notification_kind', ref: kind },
        ],
        detectionContext,
        isTraining: current.controlStatus === 'training',
      };
      const output = resolveNotificationMessage(notification, {
        definitionId: isCorrected
          ? 'weather-bosai-bulletin-corrected'
          : 'weather-bosai-bulletin-tornado-warning',
        detail: isCorrected ? '竜巻注意' : undefined,
      });
      planned.push({ kind, notification, output });
    }

    if (hasTornadoSighting) {
      const kind: BosaiNotificationKind = 'tornado-sighting';
      const notificationId = notificationIdFactory();
      const notification: WeatherNotification = {
        notificationId,
        origin: 'weather',
        category: 'question',
        changeType: isCorrected ? 'corrected' : 'new',
        sourceType: 'bosai_bulletin',
        sourceVersion,
        targets: targetTuple,
        occurredAt: current.reportDateTime,
        detectedAt,
        relatedRefs: [
          { type: 'bosai_bulletin', ref: current.eventId },
          { type: 'venue', ref: venueId },
          { type: 'bosai_notification_kind', ref: kind },
        ],
        detectionContext,
        isTraining: current.controlStatus === 'training',
      };
      const output = resolveNotificationMessage(notification, {
        definitionId: isCorrected
          ? 'weather-bosai-bulletin-corrected'
          : 'weather-bosai-bulletin-tornado-sighting',
        detail: isCorrected ? '竜巻目撃' : undefined,
      });
      planned.push({ kind, notification, output });
    }

    return {
      notifications: planned,
      skipped: [],
    };
  }

  // VPBS50
  if (current.isCancelled) {
    const currentHasKnownTag =
      current.informationTag !== null &&
      (VPBS50_TARGET_TAGS as readonly string[]).includes(current.informationTag);
    const currentHasAreas = current.areas.length > 0;

    const previousHasKnownTag =
      previous !== null &&
      !previous.isCancelled &&
      previous.informationTag !== null &&
      (VPBS50_TARGET_TAGS as readonly string[]).includes(previous.informationTag);
    const previousHasAreas =
      previous !== null && !previous.isCancelled && previous.areas.length > 0;

    // 食い違い検査
    if (
      current.informationTag !== null &&
      previousHasKnownTag &&
      current.informationTag !== previous!.informationTag
    ) {
      return {
        notifications: [],
        skipped: [
          {
            reason: 'ambiguous_cancellation_target',
            detail: `取消電文の種別 (${current.informationTag}) と previous の種別 (${previous!.informationTag}) が不一致です (eventId: ${current.eventId})`,
            eventId: current.eventId,
          },
        ],
      };
    }

    if (currentHasAreas && previousHasAreas) {
      const currCodes = new Set(current.areas.map((a) => a.areaCode));
      const prevCodes = new Set(previous!.areas.map((a) => a.areaCode));
      const sameAreas =
        currCodes.size === prevCodes.size && [...currCodes].every((c) => prevCodes.has(c));
      if (!sameAreas) {
        return {
          notifications: [],
          skipped: [
            {
              reason: 'ambiguous_cancellation_target',
              detail: `取消電文の区域集合と previous の区域集合が不一致です (eventId: ${current.eventId})`,
              eventId: current.eventId,
            },
          ],
        };
      }
    }

    let chosenTag: string | null = null;
    let chosenAreas: readonly BosaiBulletinAreaInput[] = [];

    if (currentHasKnownTag && currentHasAreas) {
      chosenTag = current.informationTag;
      chosenAreas = current.areas;
    } else if (previousHasKnownTag && previousHasAreas) {
      chosenTag = previous!.informationTag;
      chosenAreas = previous!.areas;
    } else {
      return {
        notifications: [],
        skipped: [
          {
            reason: 'unknown_cancellation_target',
            detail: `取消対象の種別または区域を特定できません (eventId: ${current.eventId})`,
            eventId: current.eventId,
          },
        ],
      };
    }

    const hasVenueArea = chosenAreas.some((a) =>
      (venueIncludedAreaCodes as readonly string[]).includes(a.areaCode),
    );
    if (!hasVenueArea) {
      return {
        notifications: [],
        skipped: [
          {
            reason: 'outside_venue',
            detail: '取消対象区域が会場外です',
          },
        ],
      };
    }

    const tagInfo = chosenTag ? VPBS50_KIND_BY_TAG[chosenTag] : undefined;
    if (!tagInfo) {
      return {
        notifications: [],
        skipped: [
          {
            reason: 'unsupported_tag',
            detail: `対象外の情報タグです: ${chosenTag}`,
          },
        ],
      };
    }

    const notificationId = notificationIdFactory();
    const notification: WeatherNotification = {
      notificationId,
      origin: 'weather',
      category: 'warning',
      changeType: 'cancelled',
      sourceType: 'bosai_bulletin',
      sourceVersion,
      targets: targetTuple,
      occurredAt: current.reportDateTime,
      detectedAt,
      relatedRefs: [
        { type: 'bosai_bulletin', ref: current.eventId },
        { type: 'venue', ref: venueId },
        { type: 'bosai_notification_kind', ref: tagInfo.kind },
      ],
      detectionContext,
      isTraining: current.controlStatus === 'training',
    };

    const output = resolveNotificationMessage(notification, {
      definitionId: 'weather-bosai-bulletin-cancelled',
      detail: tagInfo.detailText,
    });

    return {
      notifications: [{ kind: tagInfo.kind, notification, output }],
      skipped: [],
    };
  }

  // VPBS50 発表 / 訂正
  const tagInfo = current.informationTag ? VPBS50_KIND_BY_TAG[current.informationTag] : undefined;
  if (!tagInfo) {
    return {
      notifications: [],
      skipped: [
        {
          reason: 'unsupported_tag',
          detail: `対象外の情報タグです: ${current.informationTag ?? '(null)'}`,
        },
      ],
    };
  }

  const hasVenueArea = current.areas.some((a) =>
    (venueIncludedAreaCodes as readonly string[]).includes(a.areaCode),
  );
  if (!hasVenueArea) {
    return {
      notifications: [],
      skipped: [
        {
          reason: 'outside_venue',
          detail: '会場区域に一致する区域が含まれていません',
        },
      ],
    };
  }

  const isCorrected = current.infoType === '訂正';
  const notificationId = notificationIdFactory();
  const notification: WeatherNotification = {
    notificationId,
    origin: 'weather',
    category: 'question',
    changeType: isCorrected ? 'corrected' : 'new',
    sourceType: 'bosai_bulletin',
    sourceVersion,
    targets: targetTuple,
    occurredAt: current.reportDateTime,
    detectedAt,
    relatedRefs: [
      { type: 'bosai_bulletin', ref: current.eventId },
      { type: 'venue', ref: venueId },
      { type: 'bosai_notification_kind', ref: tagInfo.kind },
    ],
    detectionContext,
    isTraining: current.controlStatus === 'training',
  };

  const output = resolveNotificationMessage(notification, {
    definitionId: isCorrected ? 'weather-bosai-bulletin-corrected' : tagInfo.issuedDefinitionId,
    detail: isCorrected ? tagInfo.detailText : undefined,
  });

  return {
    notifications: [{ kind: tagInfo.kind, notification, output }],
    skipped: [],
  };
}
