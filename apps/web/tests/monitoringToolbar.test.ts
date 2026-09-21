import './setupEnv.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyGbButtonState } from '../src/components/md/gbButtonState.ts';
import { MonitoringDialogHost } from '../src/monitoring/MonitoringDialogHost.tsx';
import { nextDialogFocusTarget } from '../src/monitoring/monitoringDialogFocus.ts';
import { monitoringOperationMessage } from '../src/monitoring/monitoringOperationMessage.ts';
import { createToolbarLocalState } from '../src/monitoring/monitoringToolbarState.ts';

const el = React.createElement;
const request = {
  requestId: '123e4567-e89b-42d3-a456-426614174000',
  operationKind: 'stop',
} as const;

test('操作行: 選択中は最新結果より優先し、完了後はsuccess/failureを区別する', () => {
  const selected = {
    ...createToolbarLocalState('monitor-root'),
    selectedOperation: 'stop' as const,
  };
  assert.equal(
    monitoringOperationMessage(selected, {
      phase: 'completed',
      request,
      response: {
        status: 'completed',
        ...request,
        targetKind: 'all',
        result: 'failure',
        requestedAt: '2026-09-22T01:02:03.000Z',
        completedAt: '2026-09-22T01:02:04.000Z',
        duplicate: true,
        errorCode: null,
        errorMessage: null,
        fetchControlState: 'stopped',
      },
    }),
    '全体：取得停止を選択中／送信で実行',
  );
  assert.equal(
    monitoringOperationMessage(createToolbarLocalState('monitor-root'), {
      phase: 'unverifiable',
      request,
      reason: 'network',
    }),
    '全体：取得停止の結果を確認できません（通信・応答異常）',
  );
});

test('ダイアログ境界: 固定タイトル・準備中表示を持ち、差し込み本文だけを置換する', () => {
  const fallback = renderToStaticMarkup(
    el(MonitoringDialogHost, { dialogId: 'reception', onClose: () => undefined }),
  );
  assert.ok(fallback.includes('受信履歴'));
  assert.ok(fallback.includes('表示内容は準備中です。'));
  assert.ok(fallback.includes('閉じる'));

  const custom = renderToStaticMarkup(
    el(MonitoringDialogHost, {
      dialogId: 'diagnostics',
      onClose: () => undefined,
      renderContent: ({ dialogId }) => el('p', null, `本文:${dialogId}`),
    }),
  );
  assert.ok(custom.includes('状態診断'));
  assert.ok(custom.includes('本文:diagnostics'));
  assert.equal(custom.includes('表示内容は準備中です。'), false);
  assert.ok(custom.includes('閉じる'));
});

test('戻るアイコン: 公開part上のpaddingトークンで内部buttonを40px幅に収める', () => {
  const css = readFileSync(new URL('../src/monitoring/monitoring.css', import.meta.url), 'utf8');
  const iconButtonRule = css.match(/\.monitoring-toolbar-icon-button \{([^}]*)\}/)?.[1];
  const iconButtonPartRule = css.match(
    /\.monitoring-toolbar-icon-button::part\(btn\) \{([^}]*)\}/,
  )?.[1];

  assert.ok(iconButtonRule);
  assert.ok(iconButtonPartRule);
  assert.ok(iconButtonRule.includes('inline-size: 40px !important;'));
  assert.ok(iconButtonRule.includes('block-size: 40px;'));
  assert.ok(iconButtonPartRule.includes('--leading-space: 10px;'));
  assert.ok(iconButtonPartRule.includes('--trailing-space: 10px;'));
});

test('Labs toggle: 選択状態を公開selectedプロパティへ同じ向きで同期する', () => {
  const button = { type: '', selected: false } as HTMLElement & {
    type: string;
    selected: boolean;
  };
  applyGbButtonState(button, true, true);
  assert.deepEqual(button, { type: 'toggle', selected: true });
  applyGbButtonState(button, true, false);
  assert.deepEqual(button, { type: 'toggle', selected: false });
});

test('モーダルフォーカス: 閉じるだけでも循環し、本文の先頭・末尾でもdialog外へ出ない', () => {
  const first = {} as HTMLElement;
  const middle = {} as HTMLElement;
  const last = {} as HTMLElement;
  assert.equal(nextDialogFocusTarget([first], first, false), first);
  assert.equal(nextDialogFocusTarget([first], first, true), first);
  assert.equal(nextDialogFocusTarget([first, middle, last], last, false), first);
  assert.equal(nextDialogFocusTarget([first, middle, last], first, true), last);
  assert.equal(nextDialogFocusTarget([first, middle, last], middle, false), null);
  assert.equal(nextDialogFocusTarget([first, middle, last], {} as HTMLElement, false), first);
});
