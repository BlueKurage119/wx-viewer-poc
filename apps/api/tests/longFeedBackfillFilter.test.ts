import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKFILL_AGGREGATE_TELEGRAM_TYPES,
  BACKFILL_LATEST_PER_GROUP,
  selectBackfillExcludedUrls,
  shouldLimitLongFeedBackfill,
} from '../src/polling/longFeedBackfillFilter.js';
import type { AtomFeedEntry } from '../src/polling/jmaXmlFeeds.js';

const BASE = 'https://www.data.jma.go.jp/developer/xml/data/';

function url(time: string, type: string, office: string, seq = 0): string {
  return `${BASE}${time}_${seq}_${type}_${office}.xml`;
}

function entry(documentUrl: string): AtomFeedEntry {
  return { id: documentUrl, title: null, summary: null, documentUrl };
}

/** 同一種別・同一官署の n 件（時刻 20261018 01..n 時、新しいほど大きい）を新しい順で返す */
function build(type: string, office: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => url(`202610180${n - i}0000`, type, office));
}

const AGGREGATE = ['VPWS50', 'VPWP50', 'VPFD51', 'VPFD61', 'VPFW60'];

test('定数: 集約5種別と件数N=3', () => {
  assert.deepEqual([...BACKFILL_AGGREGATE_TELEGRAM_TYPES].sort(), [...AGGREGATE].sort());
  assert.equal(BACKFILL_LATEST_PER_GROUP, 3);
});

for (const type of AGGREGATE) {
  test(`${type}: 同一官署に5件あると新しい3件が残り、古い2件が除外される`, () => {
    const urls = build(type, '130000', 5); // 新しい順
    const excluded = selectBackfillExcludedUrls(urls.map(entry));
    assert.deepEqual([...excluded].sort(), [urls[3]!, urls[4]!].sort());
  });
}

test('官署が異なれば別グループとして各3件残る', () => {
  const a = build('VPWP50', '130000', 5);
  const b = build('VPWP50', '270000', 4);
  const excluded = selectBackfillExcludedUrls([...a, ...b].map(entry));
  assert.deepEqual([...excluded].sort(), [a[3]!, a[4]!, b[3]!].sort());
});

test('同一官署でも種別が異なれば別グループ', () => {
  const a = build('VPWP50', '130000', 4);
  const b = build('VPFD51', '130000', 3);
  const excluded = selectBackfillExcludedUrls([...a, ...b].map(entry));
  assert.deepEqual([...excluded], [a[3]!]);
});

test('フィード上の並びが古い順・ランダム順でも結果が同じ（順序非依存）', () => {
  const urls = build('VPWS50', '010000', 6); // 新しい順
  const expected = [...selectBackfillExcludedUrls(urls.map(entry))].sort();
  assert.equal(expected.length, 3);
  const oldestFirst = [...urls].reverse();
  const shuffled = [urls[2]!, urls[5]!, urls[0]!, urls[4]!, urls[1]!, urls[3]!];
  assert.deepEqual([...selectBackfillExcludedUrls(oldestFirst.map(entry))].sort(), expected);
  assert.deepEqual([...selectBackfillExcludedUrls(shuffled.map(entry))].sort(), expected);
});

test('同時刻のときはフィード上で先に出たものが残る', () => {
  const same = [1, 2, 3, 4, 5].map((seq) => url('20261018010000', 'VPFW60', '130000', seq));
  const excluded = selectBackfillExcludedUrls(same.map(entry));
  assert.deepEqual([...excluded], [same[3]!, same[4]!]);
});

test('同一URLの重複は1件として数える', () => {
  const urls = build('VPWP50', '130000', 3);
  const withDup = [urls[0]!, urls[0]!, urls[1]!, urls[2]!];
  assert.equal(selectBackfillExcludedUrls(withDup.map(entry)).size, 0);
});

test('集約型以外の10種別は同一官署に10件あっても1件も除外されない', () => {
  const others = [
    'VPWW55',
    'VPWW56',
    'VPWW57',
    'VPWW58',
    'VPWW59',
    'VPWW60',
    'VPWW61',
    'VPHW50',
    'VPHW51',
    'VPBS50',
  ];
  const entries = others.flatMap((t) =>
    Array.from({ length: 10 }, (_, i) => {
      return entry(url(`2026101801${String(i).padStart(2, '0')}00`, t, '130000'));
    }),
  );
  assert.equal(entries.length, 100);
  assert.equal(selectBackfillExcludedUrls(entries).size, 0);
});

test('URL形式に合わない集約型エントリは除外されない', () => {
  const malformed = [
    `${BASE}20261018010000_0_VPWP50.xml`, // 官署コードなし
    `${BASE}2026101801_0_VPWP50_130000.xml`, // 時刻が14桁でない
    `${BASE}20261018010000_0_VPWP50_13000.xml`, // 官署コードが6桁でない
    `${BASE}20261018010000_0_VPWP50_130000.txt`, // 拡張子違い
    `${BASE}abc_VPWP50_130000.xml`,
  ];
  const valid = build('VPWP50', '130000', 4);
  const excluded = selectBackfillExcludedUrls([...malformed, ...valid].map(entry));
  assert.deepEqual([...excluded], [valid[3]!]);
});

test('shouldLimitLongFeedBackfill: initial/recovery × long_term のみ true', () => {
  assert.equal(shouldLimitLongFeedBackfill('initial', { role: 'long_term' }), true);
  assert.equal(shouldLimitLongFeedBackfill('recovery', { role: 'long_term' }), true);
  assert.equal(shouldLimitLongFeedBackfill('scheduled', { role: 'long_term' }), false);
  assert.equal(shouldLimitLongFeedBackfill('manual', { role: 'long_term' }), false);
  for (const trigger of ['initial', 'recovery', 'scheduled', 'manual'] as const) {
    assert.equal(shouldLimitLongFeedBackfill(trigger, { role: 'high_frequency' }), false);
  }
});
