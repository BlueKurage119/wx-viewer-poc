import './setupEnv.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MonitoringDialogHost } from '../src/monitoring/MonitoringDialogHost.tsx';
import { MonitoringToolbar } from '../src/monitoring/MonitoringToolbar.tsx';
import { nextDialogFocusTarget } from '../src/monitoring/monitoringDialogFocus.ts';
import { monitoringOperationMessage } from '../src/monitoring/monitoringOperationMessage.ts';
import {
  createToolbarLocalState,
  monitoringToolbarDefinitions,
} from '../src/monitoring/monitoringToolbarState.ts';

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
    '取得停止を選択中／送信で実行',
  );
  assert.equal(
    monitoringOperationMessage(createToolbarLocalState('monitor-root'), {
      phase: 'unverifiable',
      request,
      reason: 'network',
    }),
    '取得停止の結果を確認できません（通信・応答異常）',
  );
  const source = readFileSync(
    new URL('../src/monitoring/monitoringOperationMessage.ts', import.meta.url),
    'utf8',
  );
  assert.equal(source.includes('全体：'), false);
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

test('戻るアイコンと送信可能表示: 公開GB APIだけで寸法・配色・色遷移を定義する', () => {
  const css = readFileSync(new URL('../src/monitoring/monitoring.css', import.meta.url), 'utf8');
  const iconButtonFocusRule = css.match(
    /\.monitoring-toolbar-icon-button:focus-within \{([^}]*)\}/,
  )?.[1];
  const regularContainerRule = css.match(/\.monitoring-toolbar-button-container \{([^}]*)\}/)?.[1];
  const regularContentRule = css.match(/\.monitoring-toolbar-button-content \{([^}]*)\}/)?.[1];
  const selectedContainerRule = css.match(
    /\.monitoring-toolbar-selected \.monitoring-toolbar-button-container \{([^}]*)\}/,
  )?.[1];
  const selectedContentRule = css.match(
    /\.monitoring-toolbar-selected \.monitoring-toolbar-button-content \{([^}]*)\}/,
  )?.[1];
  const disabledContainerRule = css.match(
    /md-gb-button\[disabled\] \.monitoring-toolbar-button-container \{([^}]*)\}/,
  )?.[1];
  const disabledContentRule = css.match(
    /md-gb-button\[disabled\] \.monitoring-toolbar-button-content \{([^}]*)\}/,
  )?.[1];
  const sendReadyContainerRule = css.match(
    /\.monitoring-send-ready \.monitoring-toolbar-button-container \{([^}]*)\}/,
  )?.[1];
  const sendReadyContentRule = css.match(
    /\.monitoring-send-ready \.monitoring-toolbar-button-content-send-ready \{([^}]*)\}/,
  )?.[1];
  const backgroundKeyframes = css.match(
    /@keyframes monitoring-send-ready-background \{([\s\S]*?)\n\}/,
  )?.[1];
  const colorKeyframes = css.match(/@keyframes monitoring-send-ready-color \{([\s\S]*?)\n\}/)?.[1];
  const reducedMotionRules = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  const disabledBackground = 'hsl(from var(--md-sys-color-on-surface) h s l / 10%)';
  const disabledForeground = 'hsl(from var(--md-sys-color-on-surface) h s l / 38%)';

  assert.ok(iconButtonFocusRule);
  assert.ok(regularContainerRule);
  assert.ok(regularContentRule);
  assert.ok(selectedContainerRule);
  assert.ok(selectedContentRule);
  assert.ok(disabledContainerRule);
  assert.ok(disabledContentRule);
  assert.ok(sendReadyContainerRule);
  assert.ok(sendReadyContentRule);
  assert.ok(backgroundKeyframes);
  assert.ok(colorKeyframes);
  assert.ok(reducedMotionRules);
  assert.ok(iconButtonFocusRule.includes('outline: 3px solid var(--md-sys-color-primary);'));
  assert.ok(iconButtonFocusRule.includes('outline-offset: -3px;'));
  assert.ok(
    regularContainerRule.includes('background-color: var(--md-sys-color-primary-container);'),
  );
  assert.ok(regularContainerRule.includes('border-radius: var(--md-sys-shape-corner-md);'));
  assert.ok(regularContentRule.includes('color: var(--md-sys-color-on-primary-container);'));
  assert.ok(regularContentRule.includes('display: inline-flex;'));
  assert.ok(regularContentRule.includes('align-items: center;'));
  assert.ok(regularContentRule.includes('gap: 8px;'));
  assert.ok(
    selectedContainerRule.includes('background-color: var(--md-sys-color-tertiary-container);'),
  );
  assert.ok(selectedContentRule.includes('color: var(--md-sys-color-on-tertiary-container);'));
  assert.equal(`${selectedContainerRule}${selectedContentRule}`.includes('outline'), false);
  assert.ok(disabledContainerRule.includes(`background-color: ${disabledBackground};`));
  assert.ok(disabledContentRule.includes(`color: ${disabledForeground};`));
  assert.ok(css.includes('.monitoring-toolbar md-gb-icon-button[disabled]::part(icon-btn)'));
  assert.ok(css.includes(`--container-color: ${disabledBackground};`));
  assert.ok(css.includes(`--icon-color: ${disabledForeground};`));
  assert.ok(css.includes(`--label-text-color: ${disabledForeground};`));
  assert.ok(
    sendReadyContainerRule.includes(
      'animation: monitoring-send-ready-background 2s steps(1, end) infinite;',
    ),
  );
  assert.ok(
    sendReadyContentRule.includes(
      'animation: monitoring-send-ready-color 2s steps(1, end) infinite;',
    ),
  );
  assert.ok(backgroundKeyframes.includes('background-color: var(--md-sys-color-inverse-surface);'));
  assert.ok(colorKeyframes.includes('color: var(--md-sys-color-inverse-primary);'));
  assert.ok(backgroundKeyframes.includes('49.999%'));
  assert.ok(backgroundKeyframes.includes('99.999%'));
  assert.ok(colorKeyframes.includes('49.999%'));
  assert.ok(colorKeyframes.includes('99.999%'));
  for (const forbiddenProperty of [
    'opacity',
    'visibility',
    'display',
    'transform',
    'filter',
    'outline',
    'padding',
    'inline-size',
    'block-size',
    'border-radius',
  ]) {
    assert.equal(`${backgroundKeyframes}${colorKeyframes}`.includes(forbiddenProperty), false);
  }
  assert.ok(reducedMotionRules.includes('animation: none;'));
  assert.ok(reducedMotionRules.includes('background-color: var(--md-sys-color-inverse-surface);'));
  assert.ok(reducedMotionRules.includes('color: var(--md-sys-color-inverse-primary);'));
  assert.equal(css.includes('.monitoring-send-ready::part(btn)'), false);
  assert.equal(css.includes('overflow: clip;'), false);
  assert.equal(css.includes('.monitoring-toolbar-icon-button::part(btn)'), false);
});

test('取得操作: 通常buttonの形状を維持し、選択時だけ状態クラスと公開名を切り替える', () => {
  const toolbarMarkup = (
    selectedOperation: 'start' | 'stop' | 'force_refresh' | null,
    busy = false,
  ) =>
    renderToStaticMarkup(
      el(MonitoringToolbar, {
        model: {
          localState: { ...createToolbarLocalState('monitor-root'), selectedOperation },
          operationState: { phase: 'idle' },
          currentToolbar: monitoringToolbarDefinitions[0]!,
          busy,
          selectOperation: () => undefined,
          clearSelection: () => undefined,
          submit: () => undefined,
          openDialog: () => undefined,
          closeDialog: () => undefined,
          navigate: () => undefined,
          back: () => undefined,
          backToRoot: () => undefined,
        },
      }),
    );

  const unselected = toolbarMarkup(null);
  for (const [operation, label] of [
    ['start', '取得開始'],
    ['stop', '取得停止'],
    ['force_refresh', '強制更新'],
  ] as const) {
    const selected = toolbarMarkup(operation);
    assert.ok(unselected.includes(`aria-label="${label}"`));
    assert.ok(selected.includes(`aria-label="${label}、選択中"`));
    assert.equal((selected.match(/monitoring-toolbar-selected/g) ?? []).length, 1);
    assert.equal((selected.match(/type="toggle"/g) ?? []).length, 0);
    assert.equal(selected.includes('aria-pressed'), false);
    assert.equal((selected.match(/size="sm"/g) ?? []).length, 11);
    assert.equal((selected.match(/square=""/g) ?? []).length, 11);
  }
  assert.equal((unselected.match(/size="sm"/g) ?? []).length, 11);
  assert.equal((unselected.match(/square=""/g) ?? []).length, 11);
  assert.ok(unselected.includes('role="group" aria-label="監視メニュー移動"'));
  assert.equal((unselected.match(/slot="container"/g) ?? []).length, 9);
  assert.ok(unselected.includes('monitoring-toolbar-button-content'));
  assert.ok(unselected.includes('monitoring-toolbar-button-label'));
  assert.equal((toolbarMarkup('start', true).match(/slot="container"/g) ?? []).length, 9);
  assert.equal(unselected.includes('monitoring-send-ready'), false);
  assert.equal(toolbarMarkup('start').includes('monitoring-send-ready'), true);
  assert.equal(toolbarMarkup('start', true).includes('monitoring-send-ready'), false);
  const css = readFileSync(new URL('../src/monitoring/monitoring.css', import.meta.url), 'utf8');
  const selectedRules = [
    css.match(
      /\.monitoring-toolbar-selected \.monitoring-toolbar-button-container \{([^}]*)\}/,
    )?.[1],
    css.match(/\.monitoring-toolbar-selected \.monitoring-toolbar-button-content \{([^}]*)\}/)?.[1],
  ].join('');
  assert.ok(selectedRules);
  for (const forbiddenProperty of ['inline-size', 'block-size', 'border-radius', 'transform']) {
    assert.equal(selectedRules.includes(forbiddenProperty), false);
  }
});

test('戻るアイコン: 型付きラッパーをバレル経由で使い、通常buttonのclipを持ち込まない', () => {
  const toolbarSource = readFileSync(
    new URL('../src/monitoring/MonitoringToolbar.tsx', import.meta.url),
    'utf8',
  );
  const barrelSource = readFileSync(
    new URL('../src/components/md/index.ts', import.meta.url),
    'utf8',
  );

  assert.ok(toolbarSource.includes("import { GbButton, GbIconButton } from '../components/md';"));
  assert.ok(toolbarSource.includes('<GbIconButton'));
  assert.equal(toolbarSource.includes('md-gb-icon-button'), false);
  assert.equal(toolbarSource.includes('overflow: clip'), false);
  assert.ok(barrelSource.includes("export { GbIconButton } from './GbIconButton';"));
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
