import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import { findBosaiBulletin, saveBosaiBulletin } from '../repositories/bosaiBulletinRepository.js';
import { updateTelegramReceptionAdoption } from '../repositories/telegramReceptionRepository.js';
import type {
  BosaiBulletinTarget,
  TelegramReception,
  VphwParseResult,
} from '../repositories/types.js';
import { DEFAULT_BOSAI_BULLETIN_TARGET, parseVphw } from './jmaVphwParser.js';

export { DEFAULT_BOSAI_BULLETIN_TARGET };

export function processVphwReception(
  connection: DatabaseConnection,
  reception: TelegramReception,
  processedAt: UtcIso8601String,
  target: BosaiBulletinTarget = DEFAULT_BOSAI_BULLETIN_TARGET,
): VphwParseResult {
  if (!reception.rawBody) {
    const errorResult: VphwParseResult = {
      ok: false,
      disposition: '未対応構造',
      reason: '原文（raw_body）がありません',
    };
    const tx = connection.transaction(() => {
      updateTelegramReceptionAdoption(connection, reception.id, {
        adoptionResult: errorResult.disposition,
        adoptionReason: errorResult.reason,
        adoptionDecidedAt: processedAt,
      });
    });
    tx();
    return errorResult;
  }

  const parseResult = parseVphw(reception.rawBody, reception, target);

  const tx = connection.transaction(() => {
    if (parseResult.ok) {
      const parsed = parseResult.value;

      // 更新判定（同一 eventId・controlStatus の既存行がある場合、Control/DateTime を比較）
      const existing = findBosaiBulletin(connection, parsed.eventId, parsed.controlStatus);
      if (existing) {
        const newTime = new Date(parsed.controlDateTime).getTime();
        const existingTime = new Date(existing.controlDateTime).getTime();
        if (newTime <= existingTime) {
          updateTelegramReceptionAdoption(connection, reception.id, {
            adoptionResult: '重複または旧版',
            adoptionReason: `受信電文の controlDateTime (${parsed.controlDateTime}) が既存行 (${existing.controlDateTime}) と同じか古いためスキップしました`,
            adoptionDecidedAt: processedAt,
          });
          return;
        }
      }

      saveBosaiBulletin(connection, {
        eventId: parsed.eventId,
        controlStatus: parsed.controlStatus,
        infoType: parsed.infoType,
        reportDateTime: parsed.reportDateTime,
        controlDateTime: parsed.controlDateTime,
        title: parsed.title,
        headlineText: parsed.headlineText,
        informationTag: parsed.informationTag,
        hasSighting: parsed.hasSighting,
        isCancelled: parsed.isCancelled,
        metadata: {
          source: reception.documentUrl,
          issuedAt: parsed.reportDateTime,
          validAt: parsed.validDateTime,
          validFrom: null,
          validTo: null,
          fetchedAt: reception.receivedAt,
          lastSuccessAt: processedAt,
          availability: 'available',
          sourceVersion: parsed.infoKindVersion,
        },
        areas: parsed.areas,
      });

      updateTelegramReceptionAdoption(connection, reception.id, {
        adoptionResult: '気象防災速報として解析済み',
        adoptionReason: null,
        adoptionDecidedAt: processedAt,
      });
    } else {
      updateTelegramReceptionAdoption(connection, reception.id, {
        adoptionResult: parseResult.disposition,
        adoptionReason: parseResult.reason,
        adoptionDecidedAt: processedAt,
      });
    }
  });

  tx();
  return parseResult;
}
