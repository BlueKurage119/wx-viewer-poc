import './setupEnv.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MonitoringDashboardView } from '../src/monitoring/MonitoringDashboard.tsx';
import {
  abnormalMonitoringResponseFixture,
  delayedMonitoringResponseFixture,
  monitoringResponseFixture,
  normalMonitoringResponseFixture,
  suspendedMonitoringResponseFixture,
  unevaluatedMonitoringResponseFixture,
} from './monitoringFixture.ts';

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

  for (const name of ['settings', 'remove', 'schedule', 'article']) {
    assert.ok(html.includes(`>${name}</span>`));
  }
  assert.ok(html.includes('class="monitoring-card-icon-symbol"'));
  assert.equal(html.includes('<svg'), false);
});

test('Issue #74: 取得健全性は状態ごとに承認済みのMaterial Symbols名を表示する', () => {
  const cases = [
    [normalMonitoringResponseFixture, 'check'],
    [delayedMonitoringResponseFixture, 'check_alert'],
    [abnormalMonitoringResponseFixture, 'close'],
    [suspendedMonitoringResponseFixture, 'remove'],
    [unevaluatedMonitoringResponseFixture, 'remove'],
  ] as const;

  for (const [fixture, iconName] of cases) {
    const html = renderToStaticMarkup(
      el(MonitoringDashboardView, { state: { phase: 'ready', data: fixture } }),
    );
    assert.ok(html.includes(`>${iconName}</span>`));
  }
});

test('Issue #74: 表は固定列幅のcolgroupを持ち、注意行と異常行を行全体で強調する', () => {
  const delayedHtml = renderToStaticMarkup(
    el(MonitoringDashboardView, {
      state: { phase: 'ready', data: delayedMonitoringResponseFixture },
    }),
  );
  const abnormalHtml = renderToStaticMarkup(
    el(MonitoringDashboardView, {
      state: { phase: 'ready', data: abnormalMonitoringResponseFixture },
    }),
  );

  for (const width of [110, 80, 96, 140, 140, 140, 120, 120, 160, 220, 110, 140, 140, 130]) {
    assert.ok(delayedHtml.includes(`<col style="width:${width}px"/>`));
  }
  assert.ok(delayedHtml.includes('<tr class="monitoring-row-attention">'));
  assert.ok(abnormalHtml.includes('<tr class="monitoring-row-error">'));
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

test('K7: 情報別の反映状況表のレンダリング（th scope、6列見出し、8行名、実データ、アクセシビリティ）', () => {
  const html = renderToStaticMarkup(
    el(MonitoringDashboardView, {
      state: { phase: 'ready', data: normalMonitoringResponseFixture },
    }),
  );

  assert.ok(html.includes('id="monitoring-information-status-heading">情報別の反映状況</h2>'));

  // 6列の見出し (th scope="col") (AC-18)
  for (const header of [
    '情報名',
    '対象地域・地点',
    '反映状態',
    '情報時刻',
    '反映時刻',
    '有効な情報件数',
  ]) {
    assert.ok(html.includes(`<th scope="col">${header}</th>`));
  }

  // 8行の見出し (th scope="row") (AC-2, AC-18)
  for (const row of [
    '気象防災速報',
    '気象警報・注意報',
    '警報等時系列',
    '警報級の可能性',
    'アメダス',
    '地域時系列予報',
    '雨雲',
    'キキクル',
  ]) {
    assert.ok(html.includes(`<th scope="row">${row}</th>`));
  }

  // 実データと案C（江東区、東京地方、江戸川臨海、雨雲・キキクルは「—」） (AC-1, AC-9)
  assert.ok(html.includes('<td>江東区</td>'));
  assert.ok(html.includes('<td>東京地方</td>'));
  assert.ok(html.includes('<td>江戸川臨海</td>'));
  assert.equal(html.includes('大田区'), false);
  assert.equal(html.includes('羽田'), false);

  // 反映状態（利用可能）
  assert.ok(html.includes('monitoring-information-state monitoring-tone-normal">利用可能</td>'));

  // 時刻セルと <time dateTime> (AC-5, AC-18)
  assert.ok(
    html.includes(
      '<td class="monitoring-time"><time dateTime="2026-09-20T05:25:00.000Z">09/20 14:25:00</time></td>',
    ),
  );
  assert.ok(
    html.includes(
      '<td class="monitoring-time"><time dateTime="2026-09-20T05:25:15.000Z">09/20 14:25:15</time></td>',
    ),
  );

  // 気象防災速報は時刻が null で「—」、<time> 要素が出ない (AC-7, AC-8)
  // row.name が 気象防災速報 の行を検証
  const bulletinRowMatch = html.match(/<th scope="row">気象防災速報<\/th>(.*?)<\/tr>/);
  assert.ok(bulletinRowMatch);
  const bulletinRowHtml = bulletinRowMatch[1];
  assert.ok(bulletinRowHtml.includes('<td>江東区</td>'));
  assert.ok(bulletinRowHtml.includes('<td class="monitoring-time">—</td>'));
  assert.equal(bulletinRowHtml.includes('<time'), false);
  assert.ok(bulletinRowHtml.includes('<td class="monitoring-numeric">3</td>'));
});

test('K7: state.data === null（読込中・初回失敗）のときは情報表が全セル「—」のSkeletonTableになる (AC-12)', () => {
  const html = renderToStaticMarkup(
    el(MonitoringDashboardView, { state: { phase: 'loading', data: null } }),
  );

  assert.ok(html.includes('id="monitoring-情報別の反映状況">情報別の反映状況</h2>'));

  // 8行の見出しは存在する
  for (const row of [
    '気象防災速報',
    '気象警報・注意報',
    '警報等時系列',
    '警報級の可能性',
    'アメダス',
    '地域時系列予報',
    '雨雲',
    'キキクル',
  ]) {
    assert.ok(html.includes(`<th scope="row">${row}</th>`));
  }

  // 実データではなく skeleton の monitoring-unavailable
  assert.equal(html.includes('monitoring-information-state'), false);
  assert.equal(html.includes('利用可能'), false);
  assert.equal(html.includes('江東区'), false);
});

test('K7: state.phase: "failed" かつ前回値ありのとき、前回値の行が保持される (AC-12)', () => {
  const html = renderToStaticMarkup(
    el(MonitoringDashboardView, {
      state: { phase: 'failed', data: normalMonitoringResponseFixture },
    }),
  );

  assert.ok(html.includes('id="monitoring-information-status-heading">情報別の反映状況</h2>'));
  assert.ok(html.includes('<td>江東区</td>'));
  assert.ok(html.includes('利用可能'));
});
