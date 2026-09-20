import './setupEnv.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MonitoringDashboardView } from '../src/monitoring/MonitoringDashboard.tsx';
import { monitoringResponseFixture } from './monitoringFixture.ts';

const el = React.createElement;

test('K1: 更新中はカードを無彩色へ戻さず、更新行だけに確認中を表示する', () => {
  const html = renderToStaticMarkup(
    el(MonitoringDashboardView, {
      state: { phase: 'refreshing', data: monitoringResponseFixture },
    }),
  );

  assert.ok(html.includes('監視情報を確認中'));
  assert.equal(html.includes('monitoring-stale'), false);
  assert.ok(html.includes('自動取得停止'));
  assert.ok(html.includes('有効な情報件数'));
  assert.equal(html.includes('>要約<'), false);
});

test('K1: 通信成功後の更新行に空のメッセージ要素を残さない', () => {
  const html = renderToStaticMarkup(
    el(MonitoringDashboardView, { state: { phase: 'ready', data: monitoringResponseFixture } }),
  );
  const updateRow = html.match(/<div class="monitoring-update-row"[^>]*>(.*?)<\/div>/)?.[1];

  assert.ok(updateRow);
  assert.equal(updateRow.includes('監視情報'), false);
  assert.equal((updateRow.match(/<span/g) ?? []).length, 1);
});
