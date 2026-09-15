import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildNowcastCatalog } from '../src/map/nowcast/nowcastCatalog.ts';
import {
  buildNowcastTimelineViewModel,
  findLatestNowcastFrame,
  formatJstTime,
  formatJstMonthDateTime,
} from '../src/map/nowcast/nowcastTimeline.ts';
import { createSampleNowcastResponse } from './fixtures/nowcastFixtures.ts';

test('nowcastTimeline: buildNowcastTimelineViewModel は representative コマのみを目盛りとする', () => {
  const response = createSampleNowcastResponse();
  const catalog = buildNowcastCatalog(response);

  // 全25コマのうち、重複1コマを除く24コマが代表
  const viewModel = buildNowcastTimelineViewModel({
    catalog,
    selectedFrameId: 'N1:2026-09-15T03:00:00.000Z:2026-09-15T03:00:00.000Z',
    playing: false,
  });

  assert.equal(viewModel.frames.length, 24);
  assert.equal(viewModel.layerLabel, '雨雲ナウキャスト');
  assert.equal(viewModel.playing, false);

  // 表示日時ラベルが validTime (03:00 UTC -> 12:00 JST) に対応すること
  assert.equal(viewModel.selectedFrameLabel, '09/15 12:00');

  // 最新実況コマを選択中なので latestAvailable は false
  assert.equal(viewModel.latestAvailable, false);
});

test('nowcastTimeline: 過去コマを選択中は latestAvailable が true になる', () => {
  const response = createSampleNowcastResponse();
  const catalog = buildNowcastCatalog(response);

  // 過去の実況コマを選択 (02:00 UTC -> 11:00 JST)
  const pastFrame = catalog.frames.find((f) => f.validTime === '2026-09-15T02:00:00.000Z')!;
  assert.ok(pastFrame);

  const viewModel = buildNowcastTimelineViewModel({
    catalog,
    selectedFrameId: pastFrame.id,
    playing: false,
  });

  assert.equal(viewModel.selectedFrameLabel, '09/15 11:00');
  assert.equal(viewModel.latestAvailable, true);
});

test('nowcastTimeline: findLatestNowcastFrame は N1 実況の最新を返し、実況がない場合は最も古い予測コマを返す (§9.1)', () => {
  const response = createSampleNowcastResponse();
  const catalog = buildNowcastCatalog(response);

  const latest = findLatestNowcastFrame(catalog.frames);
  assert.ok(latest);
  // N1 の最新は 03:00
  assert.equal(latest.product, 'N1');
  assert.equal(latest.validTime, '2026-09-15T03:00:00.000Z');

  // 実況 (N1) が 0 件の場合
  const forecastOnlyResponse = createSampleNowcastResponse({
    products: {
      N1: {
        metadata: {
          ...createSampleNowcastResponse().products.N1.metadata,
          availability: 'unavailable',
        },
        data: null,
      },
      N2: createSampleNowcastResponse().products.N2,
    },
  });
  const forecastOnlyCatalog = buildNowcastCatalog(forecastOnlyResponse);
  const latestForecast = findLatestNowcastFrame(forecastOnlyCatalog.frames);
  assert.ok(latestForecast);
  // 予測群の最も古いコマ (実況に最も近い予測)
  assert.equal(latestForecast.product, 'N2');
  assert.equal(latestForecast.validTime, '2026-09-15T03:00:00.000Z');
});

test('nowcastTimeline: JST 時刻フォーマットの正確性', () => {
  assert.equal(formatJstTime('2026-09-15T02:55:00.000Z'), '11:55');
  assert.equal(formatJstMonthDateTime('2026-09-15T02:55:00.000Z'), '09/15 11:55');
});
