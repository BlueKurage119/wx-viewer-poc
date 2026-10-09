import './setupEnv.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GbButton } from '../src/components/md/GbButton.tsx';
import { WeatherWorkerPanel } from '../src/monitoring/WeatherWorkerPanel.tsx';
import type { WeatherRestartState } from '../src/monitoring/weatherRestartController.ts';
import { normalMonitoringResponseFixture } from './monitoringFixture.ts';

const request = { requestId: 'restart-focus', expectedWorkerGeneration: 'worker-1' };
const failed = {
  ...normalMonitoringResponseFixture,
  weatherRuntimes: {
    ...normalMonitoringResponseFixture.weatherRuntimes,
    acquisition: {
      ...normalMonitoringResponseFixture.weatherRuntimes.acquisition,
      workerGeneration: 'worker-1',
      lifecycle: 'failed' as const,
      restartAllowed: true,
    },
  },
};

test('GbButtonのsoftDisabledは登録前でも認識される属性で伝え、native disabledを付けない', () => {
  assert.equal(
    renderToStaticMarkup(
      React.createElement(GbButton, { color: 'filled', size: 'sm', softDisabled: true }, '操作'),
    ),
    '<md-gb-button color="filled" size="sm" soft-disabled="">操作</md-gb-button>',
  );
  assert.equal(
    renderToStaticMarkup(React.createElement(GbButton, { color: 'filled', size: 'sm' }, '操作')),
    '<md-gb-button color="filled" size="sm">操作</md-gb-button>',
  );
});

test('送信・照会・結果不明・完了後も再開ボタンはnative disabledにせず操作不可を明示する', () => {
  const completed = {
    phase: 'completed' as const,
    request,
    operation: {
      status: 'completed' as const,
      requestId: request.requestId,
      role: 'acquisition' as const,
      result: 'success' as const,
      workerGeneration: 'worker-2',
      errorCode: null,
      historyRecorded: true,
    },
  };
  const cases: readonly [WeatherRestartState, boolean, boolean][] = [
    [{ phase: 'idle' }, true, false],
    [{ phase: 'sending', request }, true, true],
    [{ phase: 'checking', request }, true, true],
    [{ phase: 'unverifiable', request }, true, true],
    [completed, false, true],
    [{ phase: 'conflict', request }, false, true],
  ];
  for (const [state, restartAllowed, expectedSoftDisabled] of cases) {
    const data = {
      ...failed,
      weatherRuntimes: {
        ...failed.weatherRuntimes,
        acquisition: { ...failed.weatherRuntimes.acquisition, restartAllowed },
      },
    };
    const html = renderToStaticMarkup(
      React.createElement(WeatherWorkerPanel, {
        data,
        unavailable: false,
        model: { state, refreshVersion: 0, restart: () => undefined, recheck: () => undefined },
      }),
    );
    const button = html.match(/<md-gb-button([^>]*)>取得Workerを再開<\/md-gb-button>/);
    assert.notEqual(button, null);
    assert.equal(/\sdisabled(?:=|\s|$)/.test(button![1]!), false, state.phase);
    assert.equal(/soft-disabled=""/.test(button![1]!), expectedSoftDisabled, state.phase);
  }
});
