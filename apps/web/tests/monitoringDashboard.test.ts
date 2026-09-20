import './setupEnv.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MonitoringDashboardView } from '../src/monitoring/MonitoringDashboard.tsx';
import { monitoringResponseFixture } from './monitoringFixture.ts';

const el = React.createElement;

test('K1: 更新中もカードを保持し、監視情報行は最終表示更新だけを表示する', () => {
  const html = renderToStaticMarkup(
    el(MonitoringDashboardView, {
      state: { phase: 'refreshing', data: monitoringResponseFixture },
    }),
  );

  assert.equal(html.includes('監視情報を確認中'), false);
  assert.equal(html.includes('monitoring-stale'), false);
  assert.ok(html.includes('自動取得停止'));
  assert.ok(html.includes('有効な情報件数'));
  assert.equal(html.includes('>要約<'), false);
});

test('K1: 通信失敗でも監視情報行に失敗メッセージを表示しない', () => {
  const html = renderToStaticMarkup(
    el(MonitoringDashboardView, { state: { phase: 'failed', data: monitoringResponseFixture } }),
  );
  const updateRow = html.match(/<div class="monitoring-update-row"[^>]*>(.*?)<\/div>/)?.[1];

  assert.ok(updateRow);
  assert.equal(updateRow.includes('監視情報を更新できません'), false);
  assert.equal(updateRow.includes('通信成功なし'), false);
  assert.equal((updateRow.match(/<span/g) ?? []).length, 1);
});

test('K1: カードアイコンはMaterial Symbolsの名前をspanで描画し、SVGを使わない', () => {
  const html = renderToStaticMarkup(
    el(MonitoringDashboardView, { state: { phase: 'ready', data: monitoringResponseFixture } }),
  );

  for (const name of ['settings', 'check_circle', 'schedule', 'article']) {
    assert.ok(html.includes(`>${name}</span>`));
  }
  assert.ok(html.includes('class="monitoring-card-icon-symbol"'));
  assert.equal(html.includes('<svg'), false);
});
