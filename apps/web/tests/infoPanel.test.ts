import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PANEL_DEFINITIONS } from '../src/map/panels/panelDefinitions.ts';
import { resolveInfoPanelDisplay } from '../src/map/panels/panelDisplayState.ts';
import { resolvePanelTarget } from '../src/map/panels/panelTargets.ts';
import { formatPanelTime } from '../src/map/panels/panelTime.ts';
import { sortCardsByTimeDescending } from '../src/map/panels/panelSort.ts';
import type { InfoPanelPresence, InfoPanelStatus } from '../src/map/panels/panelDefinitions.ts';

// AC-3: パネル順序が §5.2 と一致する
test('panelDefinitions: 6パネルの配置順が基本設計 §5.2 と一致する', () => {
  assert.deepEqual(
    PANEL_DEFINITIONS.map((d) => d.id),
    ['bosaiBulletin', 'warning', 'warningTimeSeries', 'earlyWarning', 'amedas', 'areaForecast'],
  );
});

// AC-3: panelTargets が east/trc の対象名を返す
test('panelTargets: east の対象名が §3.3 表と一致する', () => {
  assert.equal(resolvePanelTarget('east', 'bosaiBulletin'), undefined);
  assert.equal(resolvePanelTarget('east', 'warning'), '江東区');
  assert.equal(resolvePanelTarget('east', 'warningTimeSeries'), '江東区');
  assert.equal(resolvePanelTarget('east', 'earlyWarning'), '東京地方');
  assert.equal(resolvePanelTarget('east', 'amedas'), '江戸川臨海');
  assert.equal(resolvePanelTarget('east', 'areaForecast'), '東京地方');
});

test('panelTargets: trc の対象名が §3.3 表と一致する', () => {
  assert.equal(resolvePanelTarget('trc', 'bosaiBulletin'), undefined);
  assert.equal(resolvePanelTarget('trc', 'warning'), '大田区');
  assert.equal(resolvePanelTarget('trc', 'warningTimeSeries'), '大田区');
  assert.equal(resolvePanelTarget('trc', 'earlyWarning'), '東京地方');
  assert.equal(resolvePanelTarget('trc', 'amedas'), '羽田');
  assert.equal(resolvePanelTarget('trc', 'areaForecast'), '東京地方');
});

// AC-2: resolveInfoPanelDisplay が §5 の表の全セルを網羅する
const DATA_AVAILABLE: InfoPanelStatus = {
  kind: 'data',
  availability: 'available',
  time: '2026-09-24T05:00:00.000Z',
  timeKind: 'issued',
};
const DATA_STALE: InfoPanelStatus = {
  kind: 'data',
  availability: 'stale',
  time: '2026-09-24T05:00:00.000Z',
  timeKind: 'issued',
};

test('resolveInfoPanelDisplay: always 種別の5状態', () => {
  const presence: InfoPanelPresence = 'always';
  assert.equal(resolveInfoPanelDisplay(presence, { kind: 'loading' }).mode, 'skeleton');
  assert.equal(resolveInfoPanelDisplay(presence, { kind: 'failed' }).mode, 'failed');
  assert.equal(resolveInfoPanelDisplay(presence, { kind: 'empty' }).mode, 'skeleton');
  assert.equal(resolveInfoPanelDisplay(presence, DATA_AVAILABLE).mode, 'content');
  assert.equal(resolveInfoPanelDisplay(presence, DATA_STALE).mode, 'content');
});

test('resolveInfoPanelDisplay: occasional 種別の5状態', () => {
  const presence: InfoPanelPresence = 'occasional';
  assert.equal(resolveInfoPanelDisplay(presence, { kind: 'loading' }).mode, 'hidden');
  assert.equal(resolveInfoPanelDisplay(presence, { kind: 'failed' }).mode, 'hidden');
  assert.equal(resolveInfoPanelDisplay(presence, { kind: 'empty' }).mode, 'hidden');
  assert.equal(resolveInfoPanelDisplay(presence, DATA_AVAILABLE).mode, 'content');
  assert.equal(resolveInfoPanelDisplay(presence, DATA_STALE).mode, 'content');
});

// AC-6: 発表時刻の表示（当日は時刻のみ、それ以外は日付併記）
test('formatPanelTime: 同日は時刻のみ、前日以前は日付を併記する', () => {
  const now = new Date('2026-09-24T10:00:00+09:00');
  assert.equal(formatPanelTime('2026-09-24T05:05:00+09:00', 'issued', now), '05:05発表');
  assert.equal(formatPanelTime('2026-09-23T14:05:00+09:00', 'issued', now), '9/23 14:05発表');
  assert.equal(formatPanelTime('2026-09-24T05:05:00+09:00', 'observed', now), '05:05観測');
});

test('formatPanelTime: 日付境界 (00:00 JST 前後) を跨ぐ', () => {
  const now = new Date('2026-09-24T00:00:00+09:00');
  // 前日 23:59 JST は前日扱いで日付併記
  assert.equal(formatPanelTime('2026-09-23T23:59:00+09:00', 'issued', now), '9/23 23:59発表');
  // 当日 00:00 JST ちょうどは時刻のみ
  assert.equal(formatPanelTime('2026-09-24T00:00:00+09:00', 'issued', now), '00:00発表');
});

// AC-4: 速報カードの並べ替えは入力順に依存しない
test('sortCardsByTimeDescending: 入力順（古い順・新しい順）によらず新しい順になる', () => {
  const older = {
    key: 'a',
    status: {
      kind: 'data' as const,
      availability: 'available' as const,
      time: '2026-09-24T04:40:00.000Z',
      timeKind: 'issued' as const,
    },
  };
  const newer = {
    key: 'b',
    status: {
      kind: 'data' as const,
      availability: 'available' as const,
      time: '2026-09-24T05:05:00.000Z',
      timeKind: 'issued' as const,
    },
  };

  assert.deepEqual(
    sortCardsByTimeDescending([older, newer]).map((c) => c.key),
    ['b', 'a'],
  );
  assert.deepEqual(
    sortCardsByTimeDescending([newer, older]).map((c) => c.key),
    ['b', 'a'],
  );
});
