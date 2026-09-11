import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import {
  calculateNowcastWindow,
  filterNowcastFramesByWindow,
  parseNowcastTargetTimes,
} from '../src/polling/nowcastParser.js';
import {
  buildNowcastTileRelativePath,
  buildNowcastTileUrl,
  formatIsoTo14DigitUtc,
  parse14DigitUtcToIso,
} from '../src/polling/nowcastSource.js';

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures/jma/nowcast');

test('1. 順序を崩した N1、基準時刻が5分古い N2、hrpns 以外、完全重複を入力。自然キーと順序が期待配列に完全一致し、同一 validTime の別候補を失わない', () => {
  const n1Json = readFileSync(
    join(FIXTURES_DIR, 'nowcast_target_times_n1_synthetic.json'),
    'utf-8',
  );
  const resultN1 = parseNowcastTargetTimes(n1Json, 'N1');

  assert.strictEqual(resultN1.ok, true);
  if (!resultN1.ok) return;

  assert.deepStrictEqual(resultN1.frames, [
    {
      key: {
        product: 'N1',
        baseTime: '2026-09-07T03:00:00.000Z',
        validTime: '2026-09-07T03:00:00.000Z',
        element: 'hrpns',
        member: 'none',
      },
      sequence: 0,
    },
    {
      key: {
        product: 'N1',
        baseTime: '2026-09-07T02:55:00.000Z',
        validTime: '2026-09-07T03:05:00.000Z',
        element: 'hrpns',
        member: 'none',
      },
      sequence: 1,
    },
    {
      key: {
        product: 'N1',
        baseTime: '2026-09-07T03:00:00.000Z',
        validTime: '2026-09-07T03:05:00.000Z',
        element: 'hrpns',
        member: 'none',
      },
      sequence: 2,
    },
    {
      key: {
        product: 'N1',
        baseTime: '2026-09-07T03:00:00.000Z',
        validTime: '2026-09-07T03:10:00.000Z',
        element: 'hrpns',
        member: 'none',
      },
      sequence: 3,
    },
  ]);

  const n2Json = readFileSync(
    join(FIXTURES_DIR, 'nowcast_target_times_n2_synthetic.json'),
    'utf-8',
  );
  const resultN2 = parseNowcastTargetTimes(n2Json, 'N2');

  assert.strictEqual(resultN2.ok, true);
  if (!resultN2.ok) return;

  assert.deepStrictEqual(resultN2.frames, [
    {
      key: {
        product: 'N2',
        baseTime: '2026-09-07T02:55:00.000Z',
        validTime: '2026-09-07T03:05:00.000Z',
        element: 'hrpns',
        member: 'none',
      },
      sequence: 0,
    },
    {
      key: {
        product: 'N2',
        baseTime: '2026-09-07T02:55:00.000Z',
        validTime: '2026-09-07T03:55:00.000Z',
        element: 'hrpns',
        member: 'none',
      },
      sequence: 1,
    },
  ]);
});

test('2. now=2026-09-07T03:00:00.000Z、±60分の両端と各1秒外側を含める。両端のみ採用、外側除外。N2 の最遠が03:55なら04:00を追加しない。now を03:02:30に変え、5分丸めも N1 最新への移動も起きない', () => {
  const windowJson = readFileSync(
    join(FIXTURES_DIR, 'nowcast_target_times_window_synthetic.json'),
    'utf-8',
  );
  const parsed = parseNowcastTargetTimes(windowJson, 'N1');
  assert.strictEqual(parsed.ok, true);
  if (!parsed.ok) return;

  const now1 = '2026-09-07T03:00:00.000Z' as UtcIso8601String;
  const filtered1 = filterNowcastFramesByWindow(
    parsed.frames.map((f) => f.key),
    now1,
  );

  assert.deepStrictEqual(
    filtered1.map((k) => k.validTime),
    [
      '2026-09-07T02:00:00.000Z',
      '2026-09-07T02:30:00.000Z',
      '2026-09-07T03:00:00.000Z',
      '2026-09-07T03:55:00.000Z',
      '2026-09-07T04:00:00.000Z',
    ],
  );

  const n2Parsed = parseNowcastTargetTimes(
    readFileSync(join(FIXTURES_DIR, 'nowcast_target_times_n2_synthetic.json'), 'utf-8'),
    'N2',
  );
  assert.strictEqual(n2Parsed.ok, true);
  if (!n2Parsed.ok) return;
  const n2Filtered = filterNowcastFramesByWindow(
    n2Parsed.frames.map((f) => f.key),
    now1,
  );
  assert.deepStrictEqual(
    n2Filtered.map((k) => k.validTime),
    ['2026-09-07T03:05:00.000Z', '2026-09-07T03:55:00.000Z'],
  );
  assert.strictEqual(
    n2Filtered.some((k) => k.validTime === '2026-09-07T04:00:00.000Z'),
    false,
  );

  const now2 = '2026-09-07T03:02:30.000Z' as UtcIso8601String;
  const window2 = calculateNowcastWindow(now2);
  assert.strictEqual(window2.from, '2026-09-07T02:02:30.000Z');
  assert.strictEqual(window2.to, '2026-09-07T04:02:30.000Z');

  const filtered2 = filterNowcastFramesByWindow(
    parsed.frames.map((f) => f.key),
    now2,
  );
  assert.deepStrictEqual(
    filtered2.map((k) => k.validTime),
    [
      '2026-09-07T02:30:00.000Z',
      '2026-09-07T03:00:00.000Z',
      '2026-09-07T03:55:00.000Z',
      '2026-09-07T04:00:00.000Z',
      '2026-09-07T04:00:01.000Z',
    ],
  );
});

test('3. 2月30日・時刻形式不正・elements 形式不正は product 全体の解析失敗。空配列と hrpns なしは成功の空一覧', () => {
  const leapInvalidJson = JSON.stringify([
    {
      basetime: '20260230030000',
      validtime: '20260230030000',
      elements: ['hrpns'],
    },
  ]);
  const leapResult = parseNowcastTargetTimes(leapInvalidJson, 'N1');
  assert.strictEqual(leapResult.ok, false);
  if (!leapResult.ok) {
    assert.strictEqual(leapResult.errorKind, 'invalid_structure');
  }

  const invalidTimeJson = JSON.stringify([
    {
      basetime: '202609070300',
      validtime: '20260907030000',
      elements: ['hrpns'],
    },
  ]);
  const timeResult = parseNowcastTargetTimes(invalidTimeJson, 'N1');
  assert.strictEqual(timeResult.ok, false);
  if (!timeResult.ok) {
    assert.strictEqual(timeResult.errorKind, 'invalid_structure');
  }

  const invalidElementsJson = JSON.stringify([
    {
      basetime: '20260907030000',
      validtime: '20260907030000',
      elements: 'hrpns',
    },
  ]);
  const elResult = parseNowcastTargetTimes(invalidElementsJson, 'N1');
  assert.strictEqual(elResult.ok, false);
  if (!elResult.ok) {
    assert.strictEqual(elResult.errorKind, 'invalid_structure');
  }

  const emptyJson = readFileSync(join(FIXTURES_DIR, 'nowcast_target_times_empty.json'), 'utf-8');
  const emptyResult = parseNowcastTargetTimes(emptyJson, 'N1');
  assert.strictEqual(emptyResult.ok, true);
  if (emptyResult.ok) {
    assert.deepStrictEqual(emptyResult.frames, []);
  }

  const noHrpnsJson = readFileSync(
    join(FIXTURES_DIR, 'nowcast_target_times_no_hrpns.json'),
    'utf-8',
  );
  const noHrpnsResult = parseNowcastTargetTimes(noHrpnsJson, 'N1');
  assert.strictEqual(noHrpnsResult.ok, true);
  if (noHrpnsResult.ok) {
    assert.deepStrictEqual(noHrpnsResult.frames, []);
  }

  const badJsonResult = parseNowcastTargetTimes('{invalid json}', 'N1');
  assert.strictEqual(badJsonResult.ok, false);
  if (!badJsonResult.ok) {
    assert.strictEqual(badJsonResult.errorKind, 'invalid_json');
  }
});

test('4. 14桁UTC相互変換、URLおよび相対パス生成関数の検証', () => {
  const iso = '2026-09-07T03:05:00.000Z' as UtcIso8601String;
  const digits = formatIsoTo14DigitUtc(iso);
  assert.strictEqual(digits, '20260907030500');
  assert.strictEqual(parse14DigitUtcToIso(digits), iso);

  const url = buildNowcastTileUrl(
    '2026-09-07T03:00:00.000Z' as UtcIso8601String,
    '2026-09-07T03:05:00.000Z' as UtcIso8601String,
    10,
    909,
    404,
  );
  assert.strictEqual(
    url,
    'https://www.jma.go.jp/bosai/jmatile/data/nowc/20260907030000/none/20260907030500/surf/hrpns/10/909/404.png',
  );

  const relPath = buildNowcastTileRelativePath(
    'N1',
    '2026-09-07T03:00:00.000Z' as UtcIso8601String,
    '2026-09-07T03:05:00.000Z' as UtcIso8601String,
    10,
    909,
    404,
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  assert.strictEqual(
    relPath,
    'radar/N1/20260907030000/20260907030500/10/909/404/e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.png',
  );
});
