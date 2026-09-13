import crypto from 'node:crypto';

import {
  resolveNotificationMessage,
  resolveVenueForecastTargets,
  type NotificationMessageDefinitionId,
  type NotificationTarget,
  type StartupCurrentNotification,
  type SystemNotification,
  type UtcIso8601String,
  type VenueId,
  type WeatherNotification,
} from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import type { FetchHealthAggregate } from '../monitoring/fetchHealthEvaluator.js';
import { MONITORED_FETCH_SOURCES } from '../monitoring/fetchHealthSources.js';
import { findWarningCurrentSnapshot, listBosaiBulletins } from '../repositories/index.js';
import { resolveWarningCurrentTargetArea } from '../venueForecastTargets.js';
import {
  resolveBosaiBulletinExpiresAt,
  resolveBosaiBulletinSourceVersion,
} from './bosaiBulletinNotificationPlanner.js';
import { classifyWarningNotificationCategory } from './warningNotificationCategoryClassifier.js';
import { selectIssuedNotificationDefinitionId } from './warningNotificationDefinitionSelector.js';

export interface StartupProjectionInput {
  readonly venueId: VenueId;
  readonly now: UtcIso8601String;
  readonly includeWarningCategory: boolean;
  readonly fetchHealth?: FetchHealthAggregate | null;
}

export interface StartupProjectionResult {
  readonly notifications: readonly StartupCurrentNotification[];
}

const VPBS50_DEFINITION_BY_TAG: Readonly<Record<string, NotificationMessageDefinitionId>> = {
  線状降水帯発生: 'weather-bosai-bulletin-linear-rainband-observed',
  線状降水帯直前: 'weather-bosai-bulletin-linear-rainband-forecast',
  記録雨: 'weather-bosai-bulletin-record-short-rain',
};

function asTime(value: string, field: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    throw new Error(`${field} must be a valid ISO timestamp`);
  }
  return time;
}

function sortNotifications(
  notifications: StartupCurrentNotification[],
): readonly StartupCurrentNotification[] {
  return notifications.sort((left, right) => {
    const occurred = left.occurredAt.localeCompare(right.occurredAt);
    if (occurred !== 0) return occurred;
    const source = left.sourceType.localeCompare(right.sourceType);
    if (source !== 0) return source;
    const ref = left.relatedRefs[0]!.ref.localeCompare(right.relatedRefs[0]!.ref);
    if (ref !== 0) return ref;
    return left.outputId.localeCompare(right.outputId);
  });
}

function makeWeatherNotification(params: {
  readonly outputId: string;
  readonly category: StartupCurrentNotification['category'];
  readonly sourceType: 'warning_current' | 'bosai_bulletin';
  readonly sourceVersion: string | null;
  readonly targets: readonly [NotificationTarget, ...NotificationTarget[]];
  readonly occurredAt: UtcIso8601String;
  readonly relatedRefs: StartupCurrentNotification['relatedRefs'];
  readonly isTraining: boolean;
}): WeatherNotification {
  return {
    notificationId: params.outputId,
    category: params.category,
    origin: 'weather',
    changeType: 'new',
    sourceType: params.sourceType,
    sourceVersion: params.sourceVersion,
    targets: params.targets,
    occurredAt: params.occurredAt,
    detectedAt: params.occurredAt,
    relatedRefs: params.relatedRefs,
    detectionContext: 'normal',
    isTraining: params.isTraining,
  };
}

/** 保存済みの現況だけを起動応答へ投影する。保存や通知履歴への書込みはしない。 */
export function projectStartupCurrentNotifications(
  connection: DatabaseConnection,
  input: StartupProjectionInput,
  outputIdFactory: () => string = () => crypto.randomUUID(),
): StartupProjectionResult {
  const nowMs = asTime(input.now, 'now');
  const warningTarget = resolveWarningCurrentTargetArea(input.venueId);
  const notifications: StartupCurrentNotification[] = [];

  for (const controlStatus of ['normal', 'training'] as const) {
    const snapshot = findWarningCurrentSnapshot(
      connection,
      warningTarget.municipalCode,
      controlStatus,
    );
    if (!snapshot) continue;

    const target: readonly [NotificationTarget] = [
      {
        kind: 'area',
        codeType: 'jma_municipal_warning_area',
        code: warningTarget.municipalCode,
        name: warningTarget.displayName,
      },
    ];

    for (const item of snapshot.items) {
      const classification = classifyWarningNotificationCategory(item.kindCode);
      const definitionId = selectIssuedNotificationDefinitionId(item.kindCode);
      if (classification.kind !== 'classified' || definitionId === null) {
        console.warn(
          JSON.stringify({
            event: 'startup_notification_warning_skipped',
            kindCode: item.kindCode,
            reason: 'unsupported_kind_code',
          }),
        );
        continue;
      }
      if (!input.includeWarningCategory && classification.category === 'warning') continue;

      const outputId = outputIdFactory();
      const occurredAt = item.kindIssuedAt ?? snapshot.telegram.reportDateTime;
      const notification = makeWeatherNotification({
        outputId,
        category: classification.category,
        sourceType: 'warning_current',
        sourceVersion: snapshot.metadata.sourceVersion,
        targets: target,
        occurredAt,
        relatedRefs: [{ type: 'warning_current', ref: warningTarget.municipalCode }],
        isTraining: controlStatus === 'training',
      });
      notifications.push({
        outputId,
        category: notification.category,
        origin: 'weather',
        sourceType: 'warning_current',
        sourceVersion: notification.sourceVersion,
        targets: notification.targets,
        occurredAt,
        relatedRefs: notification.relatedRefs,
        isTraining: notification.isTraining,
        output: resolveNotificationMessage(notification, { definitionId, detail: item.kindName }),
      });
    }
  }

  const venueTargets = resolveVenueForecastTargets(input.venueId);
  const bosaiTarget: readonly [NotificationTarget] = [
    {
      kind: 'area',
      codeType: 'venue',
      code: input.venueId,
      name: venueTargets.venueName,
    },
  ];

  for (const controlStatus of ['normal', 'training'] as const) {
    for (const bulletin of listBosaiBulletins(connection, {
      controlStatus,
      includedAreaCodes: venueTargets.bosaiBulletin.includedAreaCodes,
    })) {
      if (bulletin.isCancelled) continue;

      const reportMs = asTime(bulletin.reportDateTime, 'bulletin.reportDateTime');
      const expiresAt = resolveBosaiBulletinExpiresAt(bulletin);
      if (!expiresAt) continue;
      const expiresMs = asTime(expiresAt, 'expiresAt');

      if (nowMs < reportMs || nowMs >= expiresMs) continue;

      const isVphw =
        bulletin.eventId.startsWith('VPHW50:') ||
        bulletin.eventId.startsWith('VPHW51:') ||
        bulletin.title.includes('竜巻注意情報');

      const sourceVersion = resolveBosaiBulletinSourceVersion(bulletin);

      if (isVphw) {
        if (bulletin.areas.some((a) => a.informationType === null)) {
          console.warn(
            JSON.stringify({
              event: 'startup_notification_bosai_skipped',
              eventId: bulletin.eventId,
              reason: 'unrecoverable_legacy_areas',
            }),
          );
          continue;
        }

        const hasTornadoWarning = bulletin.areas.some(
          (a) =>
            a.informationType !== '竜巻注意情報（目撃情報あり）' &&
            (venueTargets.bosaiBulletin.includedAreaCodes as readonly string[]).includes(
              a.areaCode,
            ),
        );

        const hasTornadoSighting = bulletin.areas.some(
          (a) =>
            a.informationType === '竜巻注意情報（目撃情報あり）' &&
            (venueTargets.bosaiBulletin.includedAreaCodes as readonly string[]).includes(
              a.areaCode,
            ),
        );

        if (hasTornadoWarning) {
          const outputId = outputIdFactory();
          const notification = makeWeatherNotification({
            outputId,
            category: 'question',
            sourceType: 'bosai_bulletin',
            sourceVersion,
            targets: bosaiTarget,
            occurredAt: bulletin.reportDateTime,
            relatedRefs: [{ type: 'bosai_bulletin', ref: bulletin.eventId }],
            isTraining: controlStatus === 'training',
          });
          notifications.push({
            outputId,
            category: 'question',
            origin: 'weather',
            sourceType: 'bosai_bulletin',
            sourceVersion,
            targets: notification.targets,
            occurredAt: notification.occurredAt,
            relatedRefs: notification.relatedRefs,
            isTraining: notification.isTraining,
            output: resolveNotificationMessage(notification, {
              definitionId: 'weather-bosai-bulletin-tornado-warning',
            }),
          });
        }

        if (hasTornadoSighting) {
          const outputId = outputIdFactory();
          const notification = makeWeatherNotification({
            outputId,
            category: 'question',
            sourceType: 'bosai_bulletin',
            sourceVersion,
            targets: bosaiTarget,
            occurredAt: bulletin.reportDateTime,
            relatedRefs: [{ type: 'bosai_bulletin', ref: bulletin.eventId }],
            isTraining: controlStatus === 'training',
          });
          notifications.push({
            outputId,
            category: 'question',
            origin: 'weather',
            sourceType: 'bosai_bulletin',
            sourceVersion,
            targets: notification.targets,
            occurredAt: notification.occurredAt,
            relatedRefs: notification.relatedRefs,
            isTraining: notification.isTraining,
            output: resolveNotificationMessage(notification, {
              definitionId: 'weather-bosai-bulletin-tornado-sighting',
            }),
          });
        }
      } else {
        // VPBS50
        const definitionId =
          bulletin.informationTag === null
            ? undefined
            : VPBS50_DEFINITION_BY_TAG[bulletin.informationTag];
        if (definitionId === undefined) {
          console.warn(
            JSON.stringify({
              event: 'startup_notification_bosai_skipped',
              eventId: bulletin.eventId,
              reason: 'unsupported_information_tag',
            }),
          );
          continue;
        }
        const outputId = outputIdFactory();
        const notification = makeWeatherNotification({
          outputId,
          category: 'question',
          sourceType: 'bosai_bulletin',
          sourceVersion,
          targets: bosaiTarget,
          occurredAt: bulletin.reportDateTime,
          relatedRefs: [{ type: 'bosai_bulletin', ref: bulletin.eventId }],
          isTraining: controlStatus === 'training',
        });
        notifications.push({
          outputId,
          category: 'question',
          origin: 'weather',
          sourceType: 'bosai_bulletin',
          sourceVersion,
          targets: notification.targets,
          occurredAt: notification.occurredAt,
          relatedRefs: notification.relatedRefs,
          isTraining: notification.isTraining,
          output: resolveNotificationMessage(notification, { definitionId }),
        });
      }
    }
  }

  // system (fetch_health)
  if (input.fetchHealth && input.fetchHealth.sources) {
    for (const sourceResult of input.fetchHealth.sources) {
      if (sourceResult.status !== 'delayed' && sourceResult.status !== 'abnormal') {
        continue;
      }

      const isDelayed = sourceResult.status === 'delayed';
      if (isDelayed && !input.includeWarningCategory) {
        continue;
      }

      const sourceDef = MONITORED_FETCH_SOURCES.find((s) => s.id === sourceResult.sourceId);
      if (!sourceDef) continue;

      const category = isDelayed ? 'warning' : 'question';
      const definitionId = isDelayed ? 'system-data-fetch-delayed' : 'system-data-fetch-failed';
      const detail = sourceResult.reasons[0]?.text ?? sourceDef.displayName;
      const outputId = outputIdFactory();

      const target: readonly [NotificationTarget] = [
        {
          kind: 'equipment',
          codeType: 'wx-viewer-poc/fetch-source',
          code: sourceDef.id,
          name: sourceDef.displayName,
        },
      ];

      const systemNotification: SystemNotification = {
        notificationId: outputId,
        origin: 'system',
        category,
        changeType: isDelayed ? 'fetch_delayed' : 'fetch_abnormal',
        sourceType: 'fetch_health',
        sourceVersion: null,
        targets: target,
        occurredAt: input.fetchHealth.evaluatedAt,
        detectedAt: input.fetchHealth.evaluatedAt,
        relatedRefs: [{ type: 'fetch_source', ref: sourceDef.id }],
        detectionContext: 'normal',
        isTraining: false,
      };

      const output = resolveNotificationMessage(systemNotification, {
        definitionId,
        detail,
      });

      notifications.push({
        outputId,
        category,
        origin: 'system',
        sourceType: 'fetch_health',
        sourceVersion: null,
        targets: systemNotification.targets,
        occurredAt: systemNotification.occurredAt,
        relatedRefs: systemNotification.relatedRefs,
        isTraining: false,
        output,
      });
    }
  }

  return { notifications: sortNotifications(notifications) };
}
