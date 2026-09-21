import './setupEnv.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MonitoringDialogHost } from '../src/monitoring/MonitoringDialogHost.tsx';
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

test('戻るアイコン: 公開paddingトークンで内部buttonを40px幅に収める', () => {
  const css = readFileSync(new URL('../src/monitoring/monitoring.css', import.meta.url), 'utf8');
  const iconButtonRule = css.match(/\.monitoring-toolbar-icon-button \{([^}]*)\}/)?.[1];

  assert.ok(iconButtonRule);
  assert.ok(iconButtonRule.includes('inline-size: 40px !important;'));
  assert.ok(iconButtonRule.includes('block-size: 40px;'));
  assert.ok(iconButtonRule.includes('--leading-space: 10px;'));
  assert.ok(iconButtonRule.includes('--trailing-space: 10px;'));
});
