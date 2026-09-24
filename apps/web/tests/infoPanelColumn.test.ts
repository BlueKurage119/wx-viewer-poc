import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof React }).React = React;

import { InfoPanelColumn } from '../src/map/panels/InfoPanelColumn.tsx';
import type { InfoPanelColumnInput } from '../src/map/panels/panelDefinitions.ts';

const el = React.createElement;

function dataCard(key: string, time: string, heading?: string) {
  return {
    key,
    heading,
    status: {
      kind: 'data' as const,
      availability: 'available' as const,
      time,
      timeKind: 'issued' as const,
    },
    content: 'dummy',
  };
}

// AC-4: all-content 相当の入力で見出し順・速報の対象名なしを確認する
test('InfoPanelColumn: all-content 相当の入力でDOM順が §5.2 順＋速報新しい順になる', () => {
  const input: InfoPanelColumnInput = {
    // 入力は古い順に渡す（並べ替え確認）
    bosaiBulletin: [
      dataCard('b2', '2026-09-24T04:40:00.000Z', '東京都気象防災速報（記録的短時間大雨）'),
      dataCard('b1', '2026-09-24T05:05:00.000Z', '東京都気象防災速報（竜巻注意）'),
    ],
    warning: [dataCard('w', '2026-09-24T05:00:00.000Z')],
    warningTimeSeries: [dataCard('wt', '2026-09-24T05:00:00.000Z')],
    earlyWarning: [dataCard('e', '2026-09-24T05:00:00.000Z')],
    amedas: [dataCard('a', '2026-09-24T05:10:00.000Z')],
    areaForecast: [dataCard('f', '2026-09-24T05:00:00.000Z')],
  };

  const html = renderToStaticMarkup(el(InfoPanelColumn, { venueId: 'east', input }));

  const idxTornado = html.indexOf('東京都気象防災速報（竜巻注意）');
  const idxHeavyRain = html.indexOf('東京都気象防災速報（記録的短時間大雨）');
  const idxWarning = html.indexOf('警報・注意報');
  const idxTimeSeries = html.indexOf('警報等時系列');
  const idxEarlyWarning = html.indexOf('警報級の可能性');
  const idxAmedas = html.indexOf('アメダス');
  const idxForecast = html.indexOf('地域時系列予報');

  assert.ok(idxTornado >= 0 && idxHeavyRain >= 0);
  assert.ok(idxTornado < idxHeavyRain, '速報は発表時刻の新しい順（竜巻14:05が先）');
  assert.ok(idxHeavyRain < idxWarning);
  assert.ok(idxWarning < idxTimeSeries);
  assert.ok(idxTimeSeries < idxEarlyWarning);
  assert.ok(idxEarlyWarning < idxAmedas);
  assert.ok(idxAmedas < idxForecast);

  // 速報カードの meta 欄（対象名・時刻）には固定対象名（会場の市町村名）が出ない
  const bosaiCardStart = html.indexOf('data-panel-id="bosaiBulletin"');
  const nextCardStart = html.indexOf('data-panel-id="warning"');
  const bosaiSection = html.slice(bosaiCardStart, nextCardStart);
  assert.equal(bosaiSection.includes('江東区'), false);
});

// AC-5: mixed 相当の入力で状態別の表示が仕様どおりになる
test('InfoPanelColumn: mixed 相当の入力で状態別表示が仕様どおりになる', () => {
  const input: InfoPanelColumnInput = {
    bosaiBulletin: [{ key: 'x', status: { kind: 'empty' } }],
    warning: [
      {
        key: 'w',
        status: {
          kind: 'data',
          availability: 'stale',
          time: '2026-09-24T04:00:00.000Z',
          timeKind: 'issued',
        },
        content: 'warning-content',
      },
    ],
    warningTimeSeries: [{ key: 'wt', status: { kind: 'failed' } }],
    earlyWarning: [{ key: 'e', status: { kind: 'loading' } }],
    amedas: [
      {
        key: 'a',
        status: {
          kind: 'data',
          availability: 'stale',
          time: '2026-09-24T04:10:00.000Z',
          timeKind: 'observed',
        },
        content: 'amedas-content',
      },
    ],
    areaForecast: [
      {
        key: 'f',
        status: {
          kind: 'data',
          availability: 'available',
          time: '2026-09-24T05:00:00.000Z',
          timeKind: 'issued',
        },
        content: 'forecast-content',
      },
    ],
  };

  const html = renderToStaticMarkup(el(InfoPanelColumn, { venueId: 'east', input }));

  // 速報カードは存在しない（empty は occasional で hidden）
  assert.equal(html.includes('data-panel-id="bosaiBulletin"'), false);
  // 警報・アメダスは本文を表示し stale 装飾はない
  assert.ok(html.includes('warning-content'));
  assert.ok(html.includes('amedas-content'));
  assert.equal(html.includes('stale'), false);
  // 時系列は失敗文言
  assert.ok(html.includes('取得できませんでした'));
  // 可能性はスケルトン
  assert.ok(html.includes('info-panel-card-skeleton'));
  // 予報は本文
  assert.ok(html.includes('forecast-content'));
});
