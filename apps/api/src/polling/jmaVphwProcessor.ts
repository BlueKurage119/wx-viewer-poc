import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import { findBosaiBulletin, saveBosaiBulletin } from '../repositories/bosaiBulletinRepository.js';
import { upsertTelegramReceptionAdoptionForAllVenues } from '../repositories/telegramReceptionRepository.js';
import type {
  BosaiBulletin,
  BosaiBulletinTarget,
  ControlStatus,
  TelegramReception,
  VphwParseResult,
} from '../repositories/types.js';
import {
  emitBosaiBulletinNotificationsForReception,
  type BosaiNotificationEmitDeps,
} from '../notifications/bosaiBulletinNotificationEmitter.js';
import { DEFAULT_BOSAI_BULLETIN_TARGET, parseVphw } from './jmaVphwParser.js';

export { DEFAULT_BOSAI_BULLETIN_TARGET };

export function processVphwReception(
  connection: DatabaseConnection,
  reception: TelegramReception,
  processedAt: UtcIso8601String,
  target: BosaiBulletinTarget = DEFAULT_BOSAI_BULLETIN_TARGET,
  deps?: BosaiNotificationEmitDeps,
): VphwParseResult {
  if (!reception.rawBody) {
    const errorResult: VphwParseResult = {
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

  const parseResult = parseVphw(reception.rawBody, reception, target);

  let applied = false;
  let previousBulletin: BosaiBulletin | null = null;
  let savedBulletin: BosaiBulletin | null = null;

  const tx = connection.transaction(() => {
    if (parseResult.ok) {
      const parsed = parseResult.value;

      // 更新判定（同一 eventId・controlStatus の既存行がある場合、Control/DateTime を比較）
      const existing = findBosaiBulletin(connection, parsed.eventId, parsed.controlStatus);
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

  return parseResult;
}

export function recoverLegacyVphwBulletinAreas(connection: DatabaseConnection): void {
  const legacyRows = connection
    .prepare(
      `
      SELECT b.id, b.event_id, b.control_status, b.control_datetime, b.source
      FROM bosai_bulletin b
      WHERE (b.event_id LIKE 'VPHW50:%' OR b.event_id LIKE 'VPHW51:%')
        AND EXISTS (
          SELECT 1 FROM bosai_bulletin_area a
          WHERE a.bulletin_id = b.id AND a.information_type IS NULL
        )
    `,
    )
    .all() as {
    id: number;
    event_id: string;
    control_status: string;
    control_datetime: string;
    source: string | null;
  }[];

  for (const row of legacyRows) {
    let reception:
      | {
          id: number;
          telegram_type: string;
          control_status: string;
          report_datetime: string;
          control_datetime: string;
          raw_body: string;
        }
      | undefined;

    if (row.source) {
      reception = connection
        .prepare(
          `
          SELECT id, telegram_type, control_status, report_datetime, control_datetime, raw_body
          FROM telegram_reception
          WHERE document_url = ?
            AND raw_body IS NOT NULL
          ORDER BY id DESC
          LIMIT 1
        `,
        )
        .get(row.source) as typeof reception;
    }

    if (!reception) {
      const candidates = connection
        .prepare(
          `
          SELECT id, telegram_type, control_status, report_datetime, control_datetime, raw_body
          FROM telegram_reception
          WHERE (telegram_type = 'VPHW50' OR telegram_type = 'VPHW51')
            AND control_status = ?
            AND control_datetime = ?
            AND raw_body IS NOT NULL
          ORDER BY id DESC
        `,
        )
        .all(row.control_status, row.control_datetime) as {
        id: number;
        telegram_type: string;
        control_status: string;
        report_datetime: string;
        control_datetime: string;
        raw_body: string;
      }[];

      for (const candidate of candidates) {
        const candidateParsed = parseVphw(candidate.raw_body, {
          telegramType: candidate.telegram_type as 'VPHW50' | 'VPHW51',
          controlStatus: candidate.control_status as ControlStatus,
          reportDateTime: candidate.report_datetime,
          controlDateTime: candidate.control_datetime,
        });
        if (
          candidateParsed.ok &&
          candidateParsed.value.eventId === row.event_id &&
          candidateParsed.value.controlStatus === row.control_status &&
          candidateParsed.value.controlDateTime === row.control_datetime
        ) {
          reception = candidate;
          break;
        }
      }
    }

    if (!reception) {
      console.warn(
        `[VPHW Legacy Recovery] No matching reception raw_body found for legacy VPHW bulletin id ${row.id} eventId ${row.event_id}`,
      );
      continue;
    }

    const parseResult = parseVphw(reception.raw_body, {
      telegramType: reception.telegram_type as 'VPHW50' | 'VPHW51',
      controlStatus: reception.control_status as ControlStatus,
      reportDateTime: reception.report_datetime,
      controlDateTime: reception.control_datetime,
    });

    if (!parseResult.ok) {
      console.warn(
        `[VPHW Legacy Recovery] Parse failed for legacy VPHW bulletin id ${row.id} eventId ${row.event_id}: ${parseResult.reason}`,
      );
      continue;
    }

    if (
      parseResult.value.eventId !== row.event_id ||
      parseResult.value.controlStatus !== row.control_status ||
      parseResult.value.controlDateTime !== row.control_datetime
    ) {
      console.warn(
        `[VPHW Legacy Recovery] Parsed bulletin attributes mismatch for id ${row.id} eventId ${row.event_id}`,
      );
      continue;
    }

    const tx = connection.transaction(() => {
      connection.prepare('DELETE FROM bosai_bulletin_area WHERE bulletin_id = ?').run(row.id);
      const insertAreaStmt = connection.prepare(`
        INSERT INTO bosai_bulletin_area (
          bulletin_id, area_code, area_name, code_type, sequence, information_type
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const area of parseResult.value.areas) {
        insertAreaStmt.run(
          row.id,
          area.areaCode,
          area.areaName,
          area.codeType,
          area.sequence,
          area.informationType,
        );
      }
    });
    tx();
  }
}
