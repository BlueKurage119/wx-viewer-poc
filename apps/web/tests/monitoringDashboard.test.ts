import './setupEnv.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MonitoringDashboardView } from '../src/monitoring/MonitoringDashboard.tsx';
import { monitoringResponseFixture, normalMonitoringResponseFixture } from './monitoringFixture.ts';

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

test('K6: 取得元別の稼働状況表のレンダリング（th scope、8列見出し、6行名、実データ）', () => {
  const html = renderToStaticMarkup(
    el(MonitoringDashboardView, {
      state: { phase: 'ready', data: normalMonitoringResponseFixture },
    }),
  );

  assert.ok(html.includes('id="monitoring-source-status-heading">取得元別の稼働状況</h2>'));

  // 8列の見出し (th scope="col")
  for (const header of [
    '取得元',
    '状態',
    '適用周期',
    '最終試行',
    '最終成功',
    '次回予定',
    '直近処理時間',
    '連続失敗回数',
  ]) {
    assert.ok(html.includes(`<th scope="col">${header}</th>`));
  }

  // 6行の見出し (th scope="row")
  for (const row of [
    'XML定時フィード',
    'XML随時フィード',
    '雨雲時刻一覧',
    'キキクル時刻一覧',
    'アメダス最新時刻',
    'アメダス地点データ',
  ]) {
    assert.ok(html.includes(`<th scope="row">${row}</th>`));
  }

  // 実データの表示
  assert.ok(html.includes('monitoring-source-state monitoring-tone-normal">待機</td>'));
  assert.ok(html.includes('1分</td>'));
  assert.ok(html.includes('350 ms</td>'));
  assert.ok(html.includes('0 / 5'));

  // アメダス地点データの補足
  assert.ok(html.includes('title="経過時間による判定は行わない（失敗回数のみで判定）"'));
  assert.ok(
    html.includes(
      '<span class="monitoring-visually-hidden">経過時間による判定は行わない（失敗回数のみで判定）</span>',
    ),
  );
});

test('K6: state.data === null（読込中・初回失敗）のときは取得元表の全セルが「—」になる', () => {
  const html = renderToStaticMarkup(
    el(MonitoringDashboardView, { state: { phase: 'loading', data: null } }),
  );

  assert.ok(html.includes('id="monitoring-source-status-heading">取得元別の稼働状況</h2>'));
  // 6行の見出しは存在する
  for (const row of [
    'XML定時フィード',
    'XML随時フィード',
    '雨雲時刻一覧',
    'キキクル時刻一覧',
    'アメダス最新時刻',
    'アメダス地点データ',
  ]) {
    assert.ok(html.includes(`<th scope="row">${row}</th>`));
  }

  // 状態が「待機」等の実データになっておらず「—」
  assert.equal(html.includes('待機'), false);
  assert.equal(html.includes('正常'), false);
  assert.equal(html.includes('0 / 5'), false);
});
