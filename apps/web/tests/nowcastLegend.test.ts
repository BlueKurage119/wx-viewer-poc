import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NOWCAST_LEGEND_ITEMS,
  NOWCAST_PRESENTATION,
  NOWCAST_SOURCE_LABEL,
} from '../src/map/nowcast/nowcastLegend.ts';

test('nowcastLegend: 公式8階級とラベル、トークンが完全一致する (§7.2, §11.3)', () => {
  const expected = [
    { label: '0〜1 mm/h', token: 'var(--wx-data-nowcast-1)' },
    { label: '1〜5 mm/h', token: 'var(--wx-data-nowcast-2)' },
    { label: '5〜10 mm/h', token: 'var(--wx-data-nowcast-3)' },
    { label: '10〜20 mm/h', token: 'var(--wx-data-nowcast-4)' },
    { label: '20〜30 mm/h', token: 'var(--wx-data-nowcast-5)' },
    { label: '30〜50 mm/h', token: 'var(--wx-data-nowcast-6)' },
    { label: '50〜80 mm/h', token: 'var(--wx-data-nowcast-7)' },
    { label: '80 以上 mm/h', token: 'var(--wx-data-nowcast-8)' },
  ];

  assert.equal(NOWCAST_LEGEND_ITEMS.length, 8);
  for (let i = 0; i < 8; i++) {
    assert.equal(NOWCAST_LEGEND_ITEMS[i]!.label, expected[i]!.label);
    assert.equal(NOWCAST_LEGEND_ITEMS[i]!.swatchToken, expected[i]!.token);
  }

  // 最下位ラベルが「0〜1 mm/h」であること (「0.1〜1」ではない)
  assert.equal(NOWCAST_LEGEND_ITEMS[0]!.label, '0〜1 mm/h');

  // 出典ラベル
  assert.equal(NOWCAST_SOURCE_LABEL, '気象庁 高解像度降水ナウキャスト');
  assert.equal(NOWCAST_PRESENTATION.sourceLabel, '気象庁 高解像度降水ナウキャスト');
});
