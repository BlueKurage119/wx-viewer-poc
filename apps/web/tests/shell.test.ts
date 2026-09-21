import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  resolveTerminal,
  resolveView,
  terminals,
  views,
  type ViewId,
} from '../src/shell/config.ts';
import { operationGuideMessage, visibleNotices } from '../src/shell/notifications.ts';
import { previewNotices } from '../src/shell/fixtures.ts';
import { isUnknownTerminalDocument } from '../src/shell/terminalRouting.ts';
import { AppShell } from '../src/shell/AppShell.tsx';
import { NotificationArea } from '../src/shell/NotificationArea.tsx';
import {
  createNotificationUiState,
  receiveNotifications,
} from '../src/notifications/notificationStore.ts';
import type { MonitoringLoadState } from '../src/monitoring/useMonitoringStatus.ts';
import { normalMonitoringResponseFixture } from './monitoringFixture.ts';

const el = React.createElement;

test('登録端末のみを解決し、H/Kで同じ会場を共有する', () => {
  for (const terminal of terminals) {
    assert.equal(resolveTerminal(`/${terminal.id}`), terminal);
    assert.equal(resolveTerminal(`/${terminal.id}/`), terminal);
  }
  for (const path of [
    '/',
    '/hunknown',
    '/HKEAGH01',
    '/hkeagh01/extra',
    '//hkeagh01',
    '/constructor',
    '/toString',
  ])
    assert.equal(resolveTerminal(path), undefined);
  assert.equal(terminals[0]!.venue, terminals[1]!.venue);
  assert.equal(terminals[2]!.venue, terminals[3]!.venue);
  assert.notEqual(terminals[0]!.venue, terminals[2]!.venue);
  assert.equal(terminals[0]!.venue.weatherTargets, terminals[1]!.venue.weatherTargets);
  assert.deepEqual(terminals[0]!.venue.weatherTargets.mapReference, {
    latitude: 35.63159368010876,
    longitude: 139.79281040119963,
  });
  assert.deepEqual(terminals[2]!.venue.weatherTargets.mapReference, {
    latitude: 35.58138,
    longitude: 139.748119,
  });
  assert.deepEqual(terminals[0]!.venue.weatherTargets.warning, {
    municipalCode: '1310800',
    displayName: '江東区',
    prefectureCode: '130000',
  });
  assert.deepEqual(terminals[2]!.venue.weatherTargets.amedas, {
    stationCode: '44166',
    displayName: '羽田',
    elements: '11110000',
  });
});
test('H端末の監視・訓練通知直指定や未知ビューは防災気象情報へ戻す', () => {
  assert.equal(resolveView('#monitor', 'H'), 'weather');
  assert.equal(resolveView('#monitor', 'K'), 'monitor');
  assert.equal(resolveView('#training', 'H'), 'weather');
  assert.equal(resolveView('#training', 'K'), 'training');
  for (const mode of ['H', 'K'] as const) {
    assert.equal(resolveView('#warnings', mode), 'warnings');
    assert.equal(resolveView('#unknown', mode), 'weather');
    assert.equal(resolveView('', mode), 'weather');
  }
});
test('H表示の絞り込みは通知の生成・保持やK表示を破壊しない', () => {
  const notices = Object.freeze(previewNotices('mixed').map(Object.freeze));
  const h = visibleNotices(notices, 'H');
  assert.equal(h.length, 3);
  assert.equal(h.filter((notice) => notice.ackRequired).length, 2);
  assert.equal(visibleNotices(notices, 'K').length, 4);
  assert.equal(notices.length, 4);
  assert.ok(h.some((notice) => notice.category === 'emergency'));
});
test('H2 AC6: 監視API障害と通知受信再試行を操作ガイドで併記する', () => {
  assert.equal(
    operationGuideMessage('通知を受信できません。再試行します。', true, true),
    '取得監視: 監視情報API取得不可｜通知受信: 通知を受信できません。再試行します。',
  );
  assert.equal(
    operationGuideMessage('左のメニューから表示する画面を選択してください。', true, false),
    '取得監視: 監視情報API取得不可',
  );
});
test('H2 AC9: 通知なしでは文字のない非活性ボタン枠を各行に表示する', () => {
  const html = renderToStaticMarkup(
    el(NotificationArea, {
      state: createNotificationUiState(),
      mode: 'H',
    }),
  );
  assert.equal((html.match(/disabled=""/g) ?? []).length, 4);
  assert.equal(html.includes('確認'), false);
  assert.equal(html.includes('詳細'), false);
  assert.equal(html.includes('関連'), false);
  assert.equal(html.includes('送信'), false);
});
test('H2 AC9: 通知ありではwarningを2ボタン、問いかけを選択肢群と常時操作2ボタンで表示する', () => {
  const state = receiveNotifications(
    createNotificationUiState(),
    previewNotices('mixed'),
    'K',
  ).state;
  const html = renderToStaticMarkup(el(NotificationArea, { state, mode: 'K' }));
  assert.ok(
    html.includes(
      '<button type="button" disabled="">詳細</button><button type="button" disabled="">確認</button>',
    ),
  );
  assert.ok(
    html.includes(
      '<div class="notice-question-choices"><button type="button" disabled="">確認</button></div><div class="notice-actions"><button type="button" disabled="">詳細</button><button type="button" disabled="">送信</button></div>',
    ),
  );
  assert.equal((html.match(/disabled=""/g) ?? []).length, 5);
});
test('H1: ブザー中は専用ボタンや説明文を増やさずヘッダー全体を停止操作にする', () => {
  const terminal = terminals[0]!;
  const html = renderToStaticMarkup(
    el(
      AppShell,
      {
        terminal,
        title: '防災気象情報',
        view: 'weather',
        navigation: views.filter((item) => item.modes.includes(terminal.mode)),
        now: new Date('2026-09-21T00:00:00.000Z'),
        connection: { failed: false, lastSuccessAt: null },
        buzzer: { category: 'warning', feedKey: 'delta:warning' },
        onStopBuzzer: () => undefined,
        notifications: el('div'),
      },
      el('div'),
    ),
  );
  assert.ok(html.includes('<header class="app-header"'));
  assert.ok(html.includes('role="button"'));
  assert.ok(html.includes('tabindex="0"'));
  assert.ok(html.includes('aria-label="アラーム停止"'));
  assert.equal(html.includes('class="header-stop"'), false);
  assert.equal(html.includes('警報を確認してください'), false);
});
test('未登録HTMLアクセスのみ404対象とし、APIやモジュールを妨げない', () => {
  assert.equal(isUnknownTerminalDocument('/unknown', 'text/html'), true);
  assert.equal(isUnknownTerminalDocument('/hkeagh01/extra', 'text/html'), true);
  for (const path of [
    '/',
    '/hkeagh01/',
    '/kkeagh01?shellPreview=1',
    '/api/health',
    '/@vite/client',
  ])
    assert.equal(isUnknownTerminalDocument(path, 'text/html'), false);
  assert.equal(isUnknownTerminalDocument('/src/main.tsx', '*/*'), false);
});

test('Issue #187: 監視APIエラー時の受信異常バッジおよび操作ガイド「取得監視: 監視情報API取得不可」の表示テスト', () => {
  const terminal = terminals[1]!; // kkeagh01 (K端末)
  const baseNotices = visibleNotices(previewNotices('empty'), terminal.mode);
  const notificationState = receiveNotifications(
    createNotificationUiState(),
    baseNotices,
    terminal.mode,
  ).state;

  function computeShellStatus({
    view,
    monitoringState,
    defaultOperation = '左のメニューから表示する画面を選択してください。',
  }: {
    view: ViewId;
    monitoringState: MonitoringLoadState | null;
    defaultOperation?: string;
  }) {
    const isMonitoringFailed = view === 'monitor' && monitoringState?.phase === 'failed';
    const connection = isMonitoringFailed
      ? {
          failed: true,
          lastSuccessAt: monitoringState?.data ? new Date(monitoringState.data.generatedAt) : null,
        }
      : { failed: false, lastSuccessAt: null };
    const currentOperation = isMonitoringFailed
      ? '取得監視: 監視情報API取得不可'
      : defaultOperation;
    return { connection, currentOperation };
  }

  // 1. 初回取得失敗時（phase: 'failed', data: null）: 受信異常バッジと「通信成功なし」、操作ガイドにエラーメッセージ
  {
    const { connection, currentOperation } = computeShellStatus({
      view: 'monitor',
      monitoringState: { phase: 'failed', data: null },
    });
    assert.equal(connection.failed, true);
    assert.equal(connection.lastSuccessAt, null);
    assert.equal(currentOperation, '取得監視: 監視情報API取得不可');

    const html = renderToStaticMarkup(
      el(
        AppShell,
        {
          terminal,
          title: '取得監視',
          view: 'monitor',
          navigation: views.filter((item) => item.modes.includes(terminal.mode)),
          now: new Date('2026-09-20T05:30:00.000Z'),
          connection,
          notifications: el(NotificationArea, {
            state: { ...notificationState, operationMessage: currentOperation },
            mode: terminal.mode,
            onConfirm: () => undefined,
          }),
        },
        el('div', null, 'content'),
      ),
    );

    assert.ok(html.includes('class="connection-error"'));
    assert.ok(html.includes('受信異常'));
    assert.ok(html.includes('通信成功なし'));
    assert.ok(html.includes('取得監視: 監視情報API取得不可'));
  }

  // 2. 2回目以降取得失敗時（前回値あり、phase: 'failed', data: normalMonitoringResponseFixture）
  {
    const { connection, currentOperation } = computeShellStatus({
      view: 'monitor',
      monitoringState: { phase: 'failed', data: normalMonitoringResponseFixture },
    });
    assert.equal(connection.failed, true);
    assert.notEqual(connection.lastSuccessAt, null);
    assert.equal(currentOperation, '取得監視: 監視情報API取得不可');

    const html = renderToStaticMarkup(
      el(
        AppShell,
        {
          terminal,
          title: '取得監視',
          view: 'monitor',
          navigation: views.filter((item) => item.modes.includes(terminal.mode)),
          now: new Date('2026-09-20T05:30:00.000Z'),
          connection,
          notifications: el(NotificationArea, {
            state: { ...notificationState, operationMessage: currentOperation },
            mode: terminal.mode,
            onConfirm: () => undefined,
          }),
        },
        el('div', null, 'content'),
      ),
    );

    assert.ok(html.includes('class="connection-error"'));
    assert.ok(html.includes('受信異常'));
    // generatedAt は '2026-09-20T05:25:28.000Z' なので JST は '14:25:28'
    assert.ok(html.includes('14:25:28'));
    assert.equal(html.includes('通信成功なし'), false);
    assert.ok(html.includes('取得監視: 監視情報API取得不可'));
  }

  // 3. 復旧時（phase: 'ready', data: normalMonitoringResponseFixture）: バッジ消去、通常案内へ復帰
  {
    const { connection, currentOperation } = computeShellStatus({
      view: 'monitor',
      monitoringState: { phase: 'ready', data: normalMonitoringResponseFixture },
    });
    assert.equal(connection.failed, false);
    assert.equal(currentOperation, '左のメニューから表示する画面を選択してください。');

    const html = renderToStaticMarkup(
      el(
        AppShell,
        {
          terminal,
          title: '取得監視',
          view: 'monitor',
          navigation: views.filter((item) => item.modes.includes(terminal.mode)),
          now: new Date('2026-09-20T05:30:00.000Z'),
          connection,
          notifications: el(NotificationArea, {
            state: { ...notificationState, operationMessage: currentOperation },
            mode: terminal.mode,
            onConfirm: () => undefined,
          }),
        },
        el('div', null, 'content'),
      ),
    );

    assert.equal(html.includes('connection-error'), false);
    assert.equal(html.includes('受信異常'), false);
    assert.ok(html.includes('左のメニューから表示する画面を選択してください。'));
  }

  // 4. 監視画面エラー中に別画面（例: weather）へ切り替えた場合: バッジ・操作ガイドのクリア
  {
    const { connection, currentOperation } = computeShellStatus({
      view: 'weather',
      monitoringState: { phase: 'failed', data: normalMonitoringResponseFixture },
    });
    assert.equal(connection.failed, false);
    assert.equal(currentOperation, '左のメニューから表示する画面を選択してください。');

    const html = renderToStaticMarkup(
      el(
        AppShell,
        {
          terminal,
          title: '防災気象情報',
          view: 'weather',
          navigation: views.filter((item) => item.modes.includes(terminal.mode)),
          now: new Date('2026-09-20T05:30:00.000Z'),
          connection,
          notifications: el(NotificationArea, {
            state: { ...notificationState, operationMessage: currentOperation },
            mode: terminal.mode,
            onConfirm: () => undefined,
          }),
        },
        el('div', null, 'content'),
      ),
    );

    assert.equal(html.includes('connection-error'), false);
    assert.equal(html.includes('受信異常'), false);
    assert.ok(html.includes('左のメニューから表示する画面を選択してください。'));
  }
});
