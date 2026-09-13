import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import { findBosaiBulletin, saveBosaiBulletin } from '../repositories/bosaiBulletinRepository.js';
import { upsertTelegramReceptionAdoptionForAllVenues } from '../repositories/telegramReceptionRepository.js';
import {
  BOSAI_BULLETIN_TARGET_TAGS,
  type BosaiBulletin,
  type BosaiBulletinTarget,
  type TelegramReception,
  type Vpbs50ParseResult,
} from '../repositories/types.js';
import {
  emitBosaiBulletinNotificationsForReception,
  type BosaiNotificationEmitDeps,
} from '../notifications/bosaiBulletinNotificationEmitter.js';
import { DEFAULT_BOSAI_BULLETIN_TARGET, parseVpbs50 } from './jmaVpbs50Parser.js';

export { DEFAULT_BOSAI_BULLETIN_TARGET };

export function processVpbs50Reception(
  connection: DatabaseConnection,
  reception: TelegramReception,
  processedAt: UtcIso8601String,
  target: BosaiBulletinTarget = DEFAULT_BOSAI_BULLETIN_TARGET,
  deps?: BosaiNotificationEmitDeps,
): Vpbs50ParseResult {
  if (!reception.rawBody) {
    const errorResult: Vpbs50ParseResult = {
      ok: false,
      disposition: '未対応構造',
      reason: '原文（raw_body）がありません',
    };
    const tx = connection.transaction(() => {
      upsertTelegramReceptionAdoptionForAllVenues(connection, reception.id, {
        adoptionResult: errorResult.disposition,
        adoptionReason: errorResult.reason,
        adoptionDecidedAt: processedAt,
      });
    });
    tx();
    return errorResult;
  }

  const parseResult = parseVpbs50(reception.rawBody, reception, target, {
    allowEmptyAreasForCancellation: true,
  });

  let applied = false;
  let previousBulletin: BosaiBulletin | null = null;
  let savedBulletin: BosaiBulletin | null = null;
  let cancellationError: Vpbs50ParseResult | null = null;

  const tx = connection.transaction(() => {
    if (parseResult.ok) {
      const parsed = parseResult.value;
      const existing = findBosaiBulletin(connection, parsed.eventId, parsed.controlStatus);

      // 更新判定（同一 eventId・controlStatus の既存行がある場合、Control/DateTime を比較）
      if (existing) {
        const newTime = new Date(parsed.controlDateTime).getTime();
        const existingTime = new Date(existing.controlDateTime).getTime();
        if (newTime <= existingTime) {
          upsertTelegramReceptionAdoptionForAllVenues(connection, reception.id, {
            adoptionResult: '重複または旧版',
            adoptionReason: `受信電文の controlDateTime (${parsed.controlDateTime}) が既存行 (${existing.controlDateTime}) と同じか古いためスキップしました`,
            adoptionDecidedAt: processedAt,
          });
          return;
        }
      }

      // 区域0件の取消電文の場合の previous 検証（§10.1）
      if (parsed.isCancelled && parsed.areas.length === 0) {
        if (!existing || existing.isCancelled) {
          const reason = `unknown_cancellation_target: 取消対象の種別または区域を特定できません (receptionId: ${reception.id}, eventId: ${parsed.eventId})`;
          console.warn(reason);
          upsertTelegramReceptionAdoptionForAllVenues(connection, reception.id, {
            adoptionResult: '未対応構造',
            adoptionReason: reason,
            adoptionDecidedAt: processedAt,
          });
          cancellationError = { ok: false, disposition: '未対応構造', reason };
          return;
        }

        // previous の種別・区域完全性
        const previousHasKnownTag =
          existing.informationTag !== null &&
          (BOSAI_BULLETIN_TARGET_TAGS as readonly string[]).includes(existing.informationTag);
        const previousHasAreas = existing.areas.length > 0;

        if (!previousHasKnownTag || !previousHasAreas) {
          const reason = `unknown_cancellation_target: 取消対象の種別または区域を特定できません (receptionId: ${reception.id}, eventId: ${parsed.eventId})`;
          console.warn(reason);
          upsertTelegramReceptionAdoptionForAllVenues(connection, reception.id, {
            adoptionResult: '未対応構造',
            adoptionReason: reason,
            adoptionDecidedAt: processedAt,
          });
          cancellationError = { ok: false, disposition: '未対応構造', reason };
          return;
        }

        // 既知タグ一致
        if (parsed.informationTag !== existing.informationTag) {
          const reason = `ambiguous_cancellation_target: 取消電文の種別 (${parsed.informationTag}) と previous の種別 (${existing.informationTag}) が不一致です (receptionId: ${reception.id}, eventId: ${parsed.eventId})`;
          console.warn(reason);
          upsertTelegramReceptionAdoptionForAllVenues(connection, reception.id, {
            adoptionResult: '未対応構造',
            adoptionReason: reason,
            adoptionDecidedAt: processedAt,
          });
          cancellationError = { ok: false, disposition: '未対応構造', reason };
          return;
        }

        // previous の対象地域該当性
        const hasIncludedArea = existing.areas.some((a) =>
          target.includedAreaCodes.includes(a.areaCode),
        );
        if (!hasIncludedArea) {
          const reason = `対象会場の区域コード（${target.includedAreaCodes.join(', ')}）に一致する区域が含まれていません (receptionId: ${reception.id}, eventId: ${parsed.eventId})`;
          upsertTelegramReceptionAdoptionForAllVenues(connection, reception.id, {
            adoptionResult: '対象地域外',
            adoptionReason: reason,
            adoptionDecidedAt: processedAt,
          });
          cancellationError = { ok: false, disposition: '対象地域外', reason };
          return;
        }
      }

      previousBulletin = existing;
      savedBulletin = saveBosaiBulletin(connection, {
        eventId: parsed.eventId,
        controlStatus: parsed.controlStatus,
        infoType: parsed.infoType,
        reportDateTime: parsed.reportDateTime,
        controlDateTime: parsed.controlDateTime,
        title: parsed.title,
        headlineText: parsed.headlineText,
        informationTag: parsed.informationTag,
        hasSighting: null,
        isCancelled: parsed.isCancelled,
        metadata: {
          source: reception.documentUrl,
          issuedAt: parsed.reportDateTime,
          validAt: parsed.targetDateTime,
          validFrom: null,
          validTo: null,
          fetchedAt: reception.receivedAt,
          lastSuccessAt: processedAt,
          availability: 'available',
          sourceVersion: parsed.infoKindVersion,
        },
        areas: parsed.areas,
      });

      upsertTelegramReceptionAdoptionForAllVenues(connection, reception.id, {
        adoptionResult: '気象防災速報として解析済み',
        adoptionReason: null,
        adoptionDecidedAt: processedAt,
      });
      applied = true;
    } else {
      upsertTelegramReceptionAdoptionForAllVenues(connection, reception.id, {
        adoptionResult: parseResult.disposition,
        adoptionReason: parseResult.reason,
        adoptionDecidedAt: processedAt,
      });
    }
  });

  tx();

  if (applied && savedBulletin && deps) {
    emitBosaiBulletinNotificationsForReception(
      connection,
      reception,
      previousBulletin,
      savedBulletin,
      deps,
    );
  }

  return cancellationError ?? parseResult;
}
