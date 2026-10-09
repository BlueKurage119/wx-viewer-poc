import './setupEnv.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { VenueForecastTargets } from '@wx-viewer-poc/shared';
import {
  MonitoringDashboard,
  MonitoringDashboardView,
} from '../src/monitoring/MonitoringDashboard.tsx';
import { MonitoringToolbar } from '../src/monitoring/MonitoringToolbar.tsx';
import {
  createToolbarLocalState,
  monitoringToolbarDefinitions,
  type ToolbarLocalState,
} from '../src/monitoring/monitoringToolbarState.ts';
import {
  abnormalMonitoringResponseFixture,
  delayedMonitoringResponseFixture,
  monitoringResponseFixture,
  normalMonitoringResponseFixture,
  suspendedMonitoringResponseFixture,
  unevaluatedMonitoringResponseFixture,
} from './monitoringFixture.ts';
import { VenueRegistryProvider } from '../src/venueConfig.tsx';
import { testVenueRegistry } from './venueConfigPreload.ts';

const el = React.createElement;
const resolveTargets = (venueId: string): VenueForecastTargets | undefined => {
  const resolved = testVenueRegistry.resolveVenueId(venueId);
  return resolved ? testVenueRegistry.getVenue(resolved) : undefined;
};

test('K1: 更新中もカードを保持し、監視情報行は画面更新だけを表示する', () => {
  const html = renderToStaticMarkup(
    el(MonitoringDashboardView, {
      state: { phase: 'refreshing', data: monitoringResponseFixture },
    }),
  );

  assert.equal(html.includes('監視情報を確認中'), false);
  assert.equal(html.includes('monitoring-stale'), false);
  assert.ok(html.includes('data-card="autoFetch"'));
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
  assert.equal((updateRow.match(/<span/g) ?? []).length, 2);
  assert.ok(updateRow.includes('運転時間:'));
});

test('運転時間表示: 画面更新の左側に「メイン 運転時間: hh:mm:ss」が表示される', () => {
  const html = renderToStaticMarkup(
    el(MonitoringDashboardView, {
      state: { phase: 'ready', data: monitoringResponseFixture },
      uptimeSeconds: 3665,
    }),
  );
  const updateRow = html.match(/<div class="monitoring-update-row"[^>]*>(.*?)<\/div>/)?.[1];

  assert.ok(updateRow);
  assert.ok(updateRow.includes('<span class="monitoring-uptime">メイン 運転時間: 01:01:05</span>'));
  assert.ok(updateRow.includes('画面更新'));

  // 運転時間が画面更新よりも前（左側）に位置することを検証
  const uptimeIndex = updateRow.indexOf('運転時間: 01:01:05');
  const lastUpdateIndex = updateRow.indexOf('画面更新');
  assert.ok(uptimeIndex !== -1 && lastUpdateIndex !== -1);
  assert.ok(uptimeIndex < lastUpdateIndex);
});

test('運転時間表示: データ未取得時（data === null）は「運転時間: —」が表示される', () => {
  const html = renderToStaticMarkup(
    el(MonitoringDashboardView, {
      state: { phase: 'loading', data: null },
    }),
  );
  const updateRow = html.match(/<div class="monitoring-update-row"[^>]*>(.*?)<\/div>/)?.[1];

  assert.ok(updateRow);
  assert.ok(updateRow.includes('<span class="monitoring-uptime">メイン 運転時間: —</span>'));
  assert.ok(updateRow.includes('画面更新 —'));
});

test('K1: カードアイコンはMaterial Symbolsの名前をspanで描画し、SVGを使わない', () => {
  const html = renderToStaticMarkup(
    el(MonitoringDashboardView, { state: { phase: 'ready', data: monitoringResponseFixture } }),
  );

  for (const name of ['cloud_download', 'dns', 'settings', 'checklist']) {
    assert.ok(html.includes(`>${name}</span>`));
  }
  assert.ok(html.includes('class="monitoring-card-icon-symbol"'));
  assert.equal(html.includes('<svg'), false);
});

test('D1: 取得健全性・評価時刻・評価対象外・会場帯見出しは監視本体に存在せず、カードは4枚', () => {
  for (const fixture of [
    normalMonitoringResponseFixture,
    delayedMonitoringResponseFixture,
    abnormalMonitoringResponseFixture,
    suspendedMonitoringResponseFixture,
    unevaluatedMonitoringResponseFixture,
  ]) {
    const html = renderToStaticMarkup(
      el(MonitoringDashboardView, { state: { phase: 'ready', data: fixture } }),
    );
    for (const removed of ['取得健全性', '評価時刻', '評価対象外']) {
      assert.equal(html.includes(removed), false, removed);
    }
    // 見出しは4枚のカードと2つの表だけ。会場の帯見出しは存在しない。
    assert.deepEqual(
      [...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map((match) => match[1]),
      [
        '取得Worker',
        '提供Worker',
        '自動取得',
        '電文処理',
        '取得元別の稼働状況',
        '情報別の反映状況',
      ],
    );
    assert.equal((html.match(/<article class="monitoring-card /g) ?? []).length, 4);
    assert.equal(html.includes('monitoring-worker-section'), false);
  }
});

test('Issue #74: 表は固定比率のcolgroupを持ち、注意行と異常行を行全体で強調する', () => {
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

  for (const width of [
    11.63, 8.46, 10.15, 14.8, 14.8, 14.8, 12.68, 12.68, 17.78, 24.44, 12.22, 15.56, 15.56, 14.44,
  ]) {
    assert.ok(delayedHtml.includes(`<col style="width:${width}%"/>`));
  }
  assert.ok(delayedHtml.includes('<tr class="monitoring-row-attention">'));
  assert.ok(abnormalHtml.includes('<tr class="monitoring-row-error">'));
});

function toolbarModel(toolbarId: string) {
  return {
    localState: createToolbarLocalState('monitor-root'),
    operationState: { phase: 'idle' } as const,
    currentToolbar: monitoringToolbarDefinitions.find((item) => item.id === toolbarId)!,
    definitions: monitoringToolbarDefinitions,
    busy: false,
    selectOperation: () => undefined,
    selectWorkerRestart: () => undefined,
    clearSelection: () => undefined,
    submit: () => undefined,
    openDialog: () => undefined,
    closeDialog: () => undefined,
    navigate: () => undefined,
    back: () => undefined,
    backToRoot: () => undefined,
  };
}

test('Issue #75: 監視ツールバーはM3 Expressiveのスクエア型10ボタンを使用する', () => {
  const html = renderToStaticMarkup(el(MonitoringToolbar, { model: toolbarModel('monitor-root') }));

  assert.equal((html.match(/<md-gb-button/g) ?? []).length, 8);
  assert.equal((html.match(/<md-gb-icon-button/g) ?? []).length, 2);
  assert.equal(html.includes('md-filled-button'), false);
  assert.equal((html.match(/color="filled"/g) ?? []).length, 10);
  assert.equal((html.match(/size="sm"/g) ?? []).length, 10);
  assert.equal((html.match(/square=""/g) ?? []).length, 10);
  // 戻る2つは無効、クリア・送信は未選択のためフォーカスを保てる無効（soft-disabled）
  assert.equal((html.match(/ disabled=""/g) ?? []).length, 2);
  assert.equal((html.match(/soft-disabled=""/g) ?? []).length, 2);
  assert.equal((html.match(/type="toggle"/g) ?? []).length, 0);
  assert.equal((html.match(/type="button"/g) ?? []).length, 2);
  assert.equal(html.includes('aria-pressed'), false);
  assert.ok(html.includes('aria-label="最初のメニューへ戻る"'));
  assert.ok(html.includes('aria-label="取得開始"'));
  assert.ok(html.includes('aria-label="取得操作を送信"'));
  // 再起動ボタンは「Worker」階層だけにある
  assert.equal(html.includes('取得再起動'), false);
  assert.equal(html.includes('提供再起動'), false);
});

test('D4: 再起動ボタンは「Worker」階層だけにあり、押せないときはsoft-disabledで説明を参照する', () => {
  const html = renderToStaticMarkup(
    el(MonitoringToolbar, {
      model: toolbarModel('monitor-worker'),
      workerRestart: {
        acquisition: {
          canRestart: true,
          describedBy: 'monitoring-worker-acquisition-restartability',
        },
        delivery: { canRestart: false, describedBy: 'monitoring-worker-delivery-restartability' },
      },
    }),
  );
  assert.equal((html.match(/<md-gb-button/g) ?? []).length, 4);
  assert.ok(html.includes('取得再起動'));
  assert.ok(html.includes('提供再起動'));
  assert.equal(html.includes('取得開始'), false);
  assert.ok(html.includes('aria-describedby="monitoring-worker-delivery-restartability"'));
  const buttons = html.match(/<md-gb-button[^>]*>/g) ?? [];
  const soft = buttons.filter((tag) => tag.includes('soft-disabled=""'));
  // 提供再起動 + クリア + 送信
  assert.equal(soft.length, 3);
  assert.equal(
    soft.some((tag) => tag.includes('monitoring-worker-delivery-restartability')),
    true,
  );
  assert.equal(
    buttons.some(
      (tag) =>
        tag.includes('monitoring-worker-acquisition-restartability') &&
        tag.includes('soft-disabled'),
    ),
    false,
  );
});

test('D4: 送信ボタンの読み上げ名は選択中の操作に追従する', () => {
  const label = (selectedOperation: ToolbarLocalState['selectedOperation']) =>
    renderToStaticMarkup(
      el(MonitoringToolbar, {
        model: {
          ...toolbarModel('monitor-root'),
          localState: { ...createToolbarLocalState('monitor-root'), selectedOperation },
        },
      }),
    ).match(/aria-label="([^"]*を送信)"/)?.[1];
  assert.equal(label(null), '取得操作を送信');
  assert.equal(label('start'), '取得開始を送信');
  assert.equal(label('stop'), '取得停止を送信');
  assert.equal(label('force_refresh'), '強制更新を送信');
  assert.equal(label({ kind: 'workerRestart', role: 'acquisition' }), '取得再起動を送信');
  assert.equal(label({ kind: 'workerRestart', role: 'delivery' }), '提供再起動を送信');
});

test('K6: 取得元別の稼働状況表のレンダリング（th scope、8列見出し、6行名、実データ）', () => {
  const html = renderToStaticMarkup(
    el(MonitoringDashboardView, {
      state: { phase: 'ready', data: normalMonitoringResponseFixture },
      resolveTargets,
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
      resolveTargets,
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
      resolveTargets,
    }),
  );

  assert.ok(html.includes('id="monitoring-information-status-heading">情報別の反映状況</h2>'));
  assert.ok(html.includes('<td>江東区</td>'));
  assert.ok(html.includes('利用可能'));
});

test('Issue #187: state.phase: "failed" かつ前回値ありのとき、正常(緑)が無彩色(neutral)に抑制され、更新行は維持される', () => {
  const readyHtml = renderToStaticMarkup(
    el(MonitoringDashboardView, {
      state: { phase: 'ready', data: normalMonitoringResponseFixture },
    }),
  );
  // ready 時は正常カードや利用可能セルに monitoring-tone-normal が含まれる
  assert.ok(readyHtml.includes('monitoring-tone-normal'));
  assert.ok(readyHtml.includes('monitoring-source-state monitoring-tone-normal'));
  assert.ok(readyHtml.includes('monitoring-information-state monitoring-tone-normal'));

  const failedHtml = renderToStaticMarkup(
    el(MonitoringDashboardView, {
      state: { phase: 'failed', data: normalMonitoringResponseFixture },
    }),
  );

  // failed 時は monitoring-tone-normal がすべて neutral に抑制され、存在しない
  assert.equal(failedHtml.includes('monitoring-tone-normal'), false);
  assert.ok(failedHtml.includes('monitoring-source-state monitoring-tone-neutral'));
  assert.ok(failedHtml.includes('monitoring-information-state monitoring-tone-neutral'));

  // 更新行の表示は既存のまま維持（画面更新 2026/09/20 14:25:28）
  const updateRow = failedHtml.match(/<div class="monitoring-update-row"[^>]*>(.*?)<\/div>/)?.[1];
  assert.ok(updateRow);
  assert.ok(updateRow.includes('画面更新'));
  assert.ok(updateRow.includes('2026/09/20 14:25:28'));
});

test('Issue #187: state.phase: "failed" かつ前回値ありのとき、遅延・異常トーンはそのまま維持される', () => {
  const delayedHtml = renderToStaticMarkup(
    el(MonitoringDashboardView, {
      state: { phase: 'failed', data: delayedMonitoringResponseFixture },
    }),
  );
  assert.ok(delayedHtml.includes('monitoring-row-attention'));
  assert.ok(delayedHtml.includes('monitoring-tone-attention'));

  const abnormalHtml = renderToStaticMarkup(
    el(MonitoringDashboardView, {
      state: { phase: 'failed', data: abnormalMonitoringResponseFixture },
    }),
  );
  assert.ok(abnormalHtml.includes('monitoring-row-error'));
  assert.ok(abnormalHtml.includes('monitoring-tone-error'));
});

test('Issue #187: MonitoringDashboard は onLoadStateChange prop を受け取り安全にレンダリングされる', () => {
  let callbackState: unknown = null;
  const html = renderToStaticMarkup(
    el(
      VenueRegistryProvider,
      { value: testVenueRegistry },
      el(MonitoringDashboard, {
        terminalId: 'kkeagh01',
        onLoadStateChange: (state) => {
          callbackState = state;
        },
      }),
    ),
  );
  assert.ok(html.includes('monitoring-dashboard'));
  // SSR (renderToStaticMarkup) では useEffect は実行されないため、レンダリングが例外なく完了することを確認
  assert.equal(callbackState, null);
});

test('予報3行の情報時刻は発表時刻の表示とtime属性が一致し、nullはtime要素を出さない', () => {
  for (const issuedAt of ['2026-10-08T08:00:00.000Z', null]) {
    const data = {
      ...normalMonitoringResponseFixture,
      information: normalMonitoringResponseFixture.information.map((section) => ({
        ...section,
        issuedAt,
        validAt: '2026-10-08T15:00:00.000Z',
      })),
    };
    const html = renderToStaticMarkup(
      el(MonitoringDashboardView, { state: { phase: 'ready', data }, resolveTargets }),
    );
    for (const name of ['警報等時系列', '警報級の可能性', '地域時系列予報']) {
      const row = html.match(new RegExp(`<tr[^>]*><th scope="row">${name}</th>(.*?)</tr>`))?.[1];
      assert.ok(row);
      // 行全体は地域・状態等の別契約を含むので、情報時刻セルを抽出して完全一致する。
      const timeCell = row.match(/<td class="monitoring-time">(.*?)<\/td>/)?.[1];
      assert.equal(
        timeCell,
        issuedAt === null ? '—' : '<time dateTime="2026-10-08T08:00:00.000Z">10/08 17:00:00</time>',
      );
    }
  }
});

test('C26: 集計の受領状況は更新行の「画面更新」の隣に、古いときだけ attention で出る', () => {
  const render = (weatherSampleReceivedAt: string | null) =>
    renderToStaticMarkup(
      el(MonitoringDashboardView, {
        state: {
          phase: 'ready',
          data: {
            ...normalMonitoringResponseFixture,
            weatherSampleReceivedAt,
            weatherRuntimes: {
              ...normalMonitoringResponseFixture.weatherRuntimes,
              delivery: {
                ...normalMonitoringResponseFixture.weatherRuntimes.delivery,
                mode: 'worker' as const,
              },
            },
          },
        },
      }),
    );
  const generated = Date.parse(normalMonitoringResponseFixture.generatedAt);
  const ago = (seconds: number) => new Date(generated - seconds * 1000).toISOString();
  const row = (html: string) =>
    html.match(/<div class="monitoring-update-row">(.*?)<\/div>/)?.[1] ?? '';

  for (const normal of [render(ago(3)), render(ago(15))]) {
    assert.equal(normal.includes('集計'), false);
  }
  const stale = render(ago(16));
  assert.match(
    row(stale),
    /<span class="monitoring-sample-freshness monitoring-tone-attention"[^>]*>集計 鮮度低下<\/span><span>画面更新/,
  );
  const missing = render(null);
  assert.match(
    row(missing),
    /<span class="monitoring-sample-freshness monitoring-tone-attention"[^>]*>集計 未受領<\/span><span>画面更新/,
  );
  // 提供Workerカードの詳細には集計の語を出さない
  for (const html of [stale, missing]) {
    const cards = html.match(/<section class="monitoring-cards".*?<\/section>/)?.[0] ?? '';
    assert.equal(cards.includes('集計'), false);
  }
});
