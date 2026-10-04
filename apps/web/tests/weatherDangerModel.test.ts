import './setupEnv.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  BulletinDto,
  EarlyWarningData,
  EarlyWarningResponse,
  WarningCurrentItem,
  WarningsResponse,
  WeatherDataset,
} from '@wx-viewer-poc/shared';
import { buildBosaiBulletinCards } from '../src/map/panels/bosai/bosaiBulletinCards.ts';
import {
  resolveBulletinDangerLevel,
  resolveEarlyWarningDangerLevel,
  resolveHighestDangerLevel,
  resolveWarningDangerLevel,
} from '../src/weather/weatherDangerModel.ts';

const metadata = {
  source: null,
  issuedAt: '2026-10-04T00:00:00Z',
  validAt: null,
  validFrom: null,
  validTo: null,
  fetchedAt: null,
  lastSuccessAt: null,
  availability: 'available' as const,
  sourceVersion: null,
};
const context = {
  terminalId: 'east-term',
  venueId: 'east',
  controlStatus: 'normal' as const,
  isTraining: false,
  evaluatedAt: '2026-10-04T00:00:00Z',
};
const area = { code: '130108', name: '江東区' };
function warning(codes: readonly string[]): WarningsResponse {
  const items: WarningCurrentItem[] = codes.map((kindCode, sequence) => ({
    sequence,
    kindCode,
    kindName: kindCode,
    kindStatus: '継続',
    lastKindCode: null,
    lastKindName: null,
    kindIssuedAt: null,
    sourceTelegram: 'test',
  }));
  return {
    ...context,
    area,
    metadata,
    data: { items },
    capabilities: { unsupportedKindCodes: ['04', '18'], supplementSource: 'warning-timeseries' },
  };
}

test('警報各段階・段階表記のない警報と特別警報・混在時の最高段階を返す', () => {
  for (const [codes, expected] of [
    [['10'], 2],
    [['14'], 2],
    [['03'], 3],
    [['05'], 3],
    [['43'], 4],
    [['33'], 5],
    [['36'], 5],
    [['10', '43', '03'], 4],
    [['36', '14', '43'], 5],
    [['99'], null],
    [[], null],
  ] as const) {
    assert.equal(resolveWarningDangerLevel(warning(codes)), expected);
  }
});

test('警報の解除後・data null・unavailableを除外しstaleの保持値は残す', () => {
  assert.equal(resolveWarningDangerLevel({ ...warning(['33']), data: null }), null);
  assert.equal(
    resolveWarningDangerLevel({
      ...warning(['33']),
      metadata: { ...metadata, availability: 'unavailable' },
    }),
    null,
  );
  assert.equal(
    resolveWarningDangerLevel({
      ...warning(['33']),
      metadata: { ...metadata, availability: 'stale' },
    }),
    5,
  );
  assert.equal(resolveWarningDangerLevel(warning(['03'])), 3);
  assert.equal(resolveWarningDangerLevel(warning([])), null);
});

type Period = readonly [string, string, string];
function segment(
  kind: 'near' | 'far',
  periods: readonly Period[],
  cells: EarlyWarningData['cells'],
): WeatherDataset<EarlyWarningData> {
  return {
    area,
    metadata: { ...metadata, issuedAt: null },
    data: {
      segment: kind,
      telegramType: kind === 'near' ? 'VPFD61' : 'VPFW60',
      timeDefines: periods.map(([timeId, timeFrom, timeTo], sequence) => ({
        timeId,
        timeFrom,
        timeTo,
        sequence,
        duration: null,
      })),
      cells,
    },
  };
}
function early(
  near: WeatherDataset<EarlyWarningData>,
  far = segment('far', [], []),
): EarlyWarningResponse {
  return { ...context, near, far };
}
function cell(refId: string, rankValue: string | null, condition: string | null = null) {
  return {
    refId,
    phenomenonCode: '大雨の警報級の可能性',
    phenomenonName: '大雨の警報級の可能性',
    rankValue,
    condition,
  };
}
const periods: readonly Period[] = [
  ['a', '2026-10-04T00:00:00Z', '2026-10-04T03:00:00Z'],
  ['b', '2026-10-04T03:00:00Z', '2026-10-04T06:00:00Z'],
  ['c', '2026-10-04T06:00:00Z', '2026-10-04T09:00:00Z'],
  ['d', '2026-10-04T09:00:00Z', '2026-10-04T12:00:00Z'],
];
const now = Date.parse('2026-10-04T01:00:00Z');

test('早期注意の中・高は近距離の4コマ目と遠距離だけでもレベル1になる', () => {
  for (const rank of ['中', '高']) {
    assert.equal(
      resolveEarlyWarningDangerLevel(early(segment('near', periods, [cell('d', rank)])), now),
      1,
    );
    assert.equal(
      resolveEarlyWarningDangerLevel(
        early(segment('near', [], []), segment('far', periods, [cell('a', rank)])),
        now,
      ),
      1,
    );
  }
});

test('早期注意の終了直前は1、終了時刻ちょうどと過去はnullになる', () => {
  const response = early(segment('near', [periods[0]], [cell('a', '中')]));
  assert.equal(resolveEarlyWarningDangerLevel(response, Date.parse('2026-10-04T02:59:59.999Z')), 1);
  assert.equal(resolveEarlyWarningDangerLevel(response, Date.parse('2026-10-04T03:00:00Z')), null);
  assert.equal(resolveEarlyWarningDangerLevel(response, Date.parse('2026-10-05T00:00:00Z')), null);
});

test('早期注意の値なし・未知値・欠測・欠損・無効な終了時刻を除外する', () => {
  for (const cells of [
    [cell('a', '高', '値なし')],
    [cell('a', '高', '欠測')],
    [cell('a', '不明')],
    [cell('a', 'なし')],
    [cell('a', null)],
    [],
  ]) {
    assert.equal(
      resolveEarlyWarningDangerLevel(early(segment('near', [periods[0]], cells)), now),
      null,
    );
  }
  assert.equal(
    resolveEarlyWarningDangerLevel(
      early(segment('near', [['a', '2026-10-04T00:00:00Z', '不明']], [cell('a', '高')])),
      now,
    ),
    null,
  );
});

test('早期注意の片側がunavailableまたはnullでも、他方の有効値を集約する', () => {
  const validNear = segment('near', periods, [cell('a', '高')]);
  const validFar = segment('far', periods, [cell('d', '中')]);
  const unavailableNear = {
    ...validNear,
    metadata: { ...metadata, availability: 'unavailable' as const },
  };
  const unavailableFar = {
    ...validFar,
    metadata: { ...metadata, availability: 'unavailable' as const },
  };
  assert.equal(resolveEarlyWarningDangerLevel(early(unavailableNear, validFar), now), 1);
  assert.equal(resolveEarlyWarningDangerLevel(early(validNear, unavailableFar), now), 1);
  assert.equal(resolveEarlyWarningDangerLevel(early(unavailableNear, unavailableFar), now), null);
  assert.equal(
    resolveEarlyWarningDangerLevel(early({ ...validNear, data: null }, validFar), now),
    1,
  );
  assert.equal(
    resolveEarlyWarningDangerLevel(
      early({ ...validNear, data: null }, { ...validFar, data: null }),
      now,
    ),
    null,
  );
});

function bulletin(overrides: Partial<BulletinDto> = {}): BulletinDto {
  return {
    eventId: 'test-event',
    telegramType: 'VPBS50',
    infoType: '発表',
    isCancelled: false,
    reportDateTime: '2026-10-04T00:00:00Z',
    controlDateTime: '2026-10-04T00:00:00Z',
    title: '東京都気象防災速報',
    headlineText: 'テスト本文',
    informationTag: '記録雨',
    hasSighting: null,
    areas: [],
    isDirect: false,
    matchedAreaCodes: [],
    metadata,
    ...overrides,
  };
}
function bulletinLevel(bulletins: readonly BulletinDto[], time: number) {
  return resolveBulletinDangerLevel(
    buildBosaiBulletinCards({ bulletins, availability: 'available', nowMs: time }),
  );
}

test('速報は表示カードと連動してVPBS50の3時間・竜巻のvalidAt境界で消える', () => {
  for (const telegramType of ['VPBS50', 'VPHW50', 'VPHW51'] as const) {
    const entry = bulletin({
      telegramType,
      metadata: { ...metadata, validAt: '2026-10-04T03:00:00Z' },
    });
    assert.equal(bulletinLevel([entry], Date.parse('2026-10-04T02:59:59.999Z')), 4);
    assert.equal(bulletinLevel([entry], Date.parse('2026-10-04T03:00:00Z')), null);
  }
});

test('速報は取消・期限不明・0件を除外し、線状降水帯直前予測は4になる', () => {
  assert.equal(bulletinLevel([bulletin({ isCancelled: true })], now), null);
  assert.equal(bulletinLevel([bulletin({ reportDateTime: '不明' })], now), null);
  assert.equal(bulletinLevel([bulletin({ telegramType: 'VPHW51' })], now), null);
  assert.equal(bulletinLevel([], now), null);
  assert.equal(bulletinLevel([bulletin({ informationTag: '線状降水帯直前予測' })], now), 4);
});

test('最高段階は速報終了・警報解除・可能性消失の順に4→2→1→nullとなる', () => {
  const advisory = resolveWarningDangerLevel(warning(['10']));
  const possibility = resolveEarlyWarningDangerLevel(
    early(segment('near', periods, [cell('d', '中')])),
    now,
  );
  assert.equal(
    resolveHighestDangerLevel([advisory, possibility, bulletinLevel([bulletin()], now)]),
    4,
  );
  assert.equal(
    resolveHighestDangerLevel([
      advisory,
      possibility,
      bulletinLevel([bulletin()], Date.parse('2026-10-04T03:00:00Z')),
    ]),
    2,
  );
  assert.equal(
    resolveHighestDangerLevel([resolveWarningDangerLevel(warning([])), possibility, null]),
    1,
  );
  assert.equal(resolveHighestDangerLevel([null, null, null]), null);
  assert.equal(resolveHighestDangerLevel([]), null);
  assert.equal(resolveHighestDangerLevel([1, 5, 4, 3, 2]), 5);
});
