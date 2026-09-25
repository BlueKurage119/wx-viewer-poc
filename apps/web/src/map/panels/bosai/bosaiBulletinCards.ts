import { createElement } from 'react';
import type { Availability, BulletinDto } from '@wx-viewer-poc/shared';
import type { InfoPanelCardInput } from '../panelDefinitions';
import { BosaiBulletinContent } from './BosaiBulletinContent';

export const VPBS50_DISPLAY_DURATION_MS = 3 * 60 * 60 * 1000;

/** 表示終了時刻（epoch ms、この時刻ちょうどで非表示）。判定できない場合 null。 */
export function resolveBulletinDisplayEnd(bulletin: BulletinDto): number | null {
  if (bulletin.telegramType === 'VPBS50') {
    const reportTime = Date.parse(bulletin.reportDateTime);
    if (Number.isNaN(reportTime)) {
      return null;
    }
    return reportTime + VPBS50_DISPLAY_DURATION_MS;
  }

  if (bulletin.telegramType === 'VPHW50' || bulletin.telegramType === 'VPHW51') {
    if (bulletin.metadata.validAt === null) {
      return null;
    }
    const validAtTime = Date.parse(bulletin.metadata.validAt);
    if (Number.isNaN(validAtTime)) {
      return null;
    }
    return validAtTime;
  }

  return null;
}

/** 表示対象か。取消・期限切れ・期限判定不能は false。 */
export function isBulletinDisplayed(bulletin: BulletinDto, nowMs: number): boolean {
  if (bulletin.isCancelled) {
    return false;
  }

  const endMs = resolveBulletinDisplayEnd(bulletin);
  if (endMs === null) {
    return false;
  }

  return nowMs < endMs;
}

/** カードに出す区域名（表示順、重複なし）。§4.3 */
export function resolveBulletinAreaNames(bulletin: BulletinDto): readonly string[] {
  const sorted = [...bulletin.areas].sort((a, b) => a.sequence - b.sequence);

  let targetAreas = sorted;
  if (bulletin.telegramType === 'VPHW50' || bulletin.telegramType === 'VPHW51') {
    targetAreas = sorted.filter((a) => a.informationType === '竜巻注意情報（発表細分）');
  } else if (bulletin.telegramType === 'VPBS50') {
    targetAreas = sorted;
  } else {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const a of targetAreas) {
    if (!seen.has(a.areaName)) {
      seen.add(a.areaName);
      result.push(a.areaName);
    }
  }

  return result;
}

/** 経過時間の文言。§4.4 */
export function formatBulletinElapsed(reportDateTime: string, nowMs: number): string {
  const reportMs = Date.parse(reportDateTime);
  const diffMs = nowMs - reportMs;

  if (diffMs < 0 || Number.isNaN(diffMs)) {
    return '0分経過';
  }

  const totalMinutes = Math.floor(diffMs / 60_000);
  if (totalMinutes < 60) {
    return `${totalMinutes}分経過`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) {
    return `${hours}時間経過`;
  }

  return `${hours}時間${minutes}分経過`;
}

/** 応答の availability をカード用の availability に変換する。§4.5 */
export function toCardAvailability(
  availability: Availability,
): Extract<Availability, 'available' | 'stale'> {
  if (availability === 'available') {
    return 'available';
  }
  return 'stale';
}

/** 応答1件からカード入力列を作る。表示対象外を除き、並びは応答順を保つ（並べ替えは InfoPanelColumn が行う）。 */
export function buildBosaiBulletinCards(params: {
  readonly bulletins: readonly BulletinDto[];
  readonly availability: Extract<Availability, 'available' | 'stale'>;
  readonly nowMs: number;
}): readonly InfoPanelCardInput[] {
  const cards: InfoPanelCardInput[] = [];

  for (const bulletin of params.bulletins) {
    if (!isBulletinDisplayed(bulletin, params.nowMs)) {
      continue;
    }

    cards.push({
      key: bulletin.eventId,
      heading: bulletin.title,
      status: {
        kind: 'data',
        availability: params.availability,
        time: bulletin.reportDateTime,
        timeKind: 'issued',
      },
      content: createElement(BosaiBulletinContent, {
        bulletin,
        nowMs: params.nowMs,
      }),
    });
  }

  return cards;
}
