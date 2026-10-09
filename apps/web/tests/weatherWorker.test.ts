import './setupEnv.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WeatherRestartOperation, WeatherRestartRequest } from '@wx-viewer-poc/shared';
import { createWeatherRestartController } from '../src/monitoring/weatherRestartController.ts';
import {
  createWeatherWorkerClient,
  parseWeatherRestartReply,
  type WeatherRestartReply,
} from '../src/api/weatherWorkers.ts';
import { WeatherWorkerPanel } from '../src/monitoring/WeatherWorkerPanel.tsx';
import {
  weatherRestartResult,
  weatherWorkerLabel,
} from '../src/monitoring/weatherWorkerPresentation.ts';
import { normalMonitoringResponseFixture as fixture } from './monitoringFixture.ts';

function timers() {
  let now = 0;
  let id = 0;
  const jobs = new Map<number, { at: number; callback: () => void }>();
  return {
    setTimeout(callback: () => void, delay: number) {
      jobs.set(++id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(timer: number) {
      jobs.delete(timer);
    },
    advance(ms: number) {
      const end = now + ms;
      while (true) {
        const next = [...jobs]
          .filter(([, value]) => value.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        jobs.delete(next[0]);
        now = next[1].at;
        next[1].callback();
      }
      now = end;
    },
    size: () => jobs.size,
  };
}
const request = { requestId: 'restart-1', expectedWorkerGeneration: 'worker-1' };
const completed: WeatherRestartOperation = {
  status: 'completed',
  requestId: 'restart-1',
  role: 'acquisition',
  result: 'success',
  workerGeneration: 'worker-2',
  errorCode: null,
  historyRecorded: true,
};
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test('再開POST応答喪失後は同じIDをGETし、二重クリックと遅延応答を抑止する', async () => {
  const clock = timers();
  let resolvePost!: (reply: WeatherRestartReply) => void;
  const posts: WeatherRestartRequest[] = [];
  const gets: WeatherRestartRequest[] = [];
  let refreshed = 0;
  const controller = createWeatherRestartController({
    ...clock,
    requestIdFactory: () => 'restart-1',
    onRefresh: () => refreshed++,
    client: {
      restart: (value) => {
        posts.push(value);
        return new Promise((resolve) => {
          resolvePost = resolve;
        });
      },
      find: async (value) => {
        gets.push(value);
        return { kind: 'operation', operation: completed };
      },
    },
  });
  controller.restart('worker-1');
  controller.restart('worker-1');
  assert.deepEqual(controller.getSnapshot(), { phase: 'sending', request });
  clock.advance(5_999);
  assert.deepEqual(gets, []);
  clock.advance(1);
  await flush();
  assert.deepEqual(posts, [request]);
  assert.deepEqual(gets, [request]);
  assert.deepEqual(controller.getSnapshot(), { phase: 'completed', request, operation: completed });
  assert.equal(refreshed, 1);
  assert.equal(clock.size(), 0);
  resolvePost({ kind: 'conflict' });
  await flush();
  assert.deepEqual(controller.getSnapshot(), { phase: 'completed', request, operation: completed });
  controller.dispose();
});

test('1秒間隔で照会し30秒で止め、明示再確認は同IDのGETのみ', async () => {
  const clock = timers();
  let posts = 0;
  const gets: WeatherRestartRequest[] = [];
  let done = false;
  const controller = createWeatherRestartController({
    ...clock,
    requestIdFactory: () => 'restart-1',
    onRefresh: () => undefined,
    client: {
      restart: async () => {
        posts++;
        return {
          kind: 'operation',
          operation: {
            status: 'in_progress',
            role: 'acquisition',
            requestId: 'restart-1',
            historyRecorded: true,
          },
        };
      },
      find: async (value) => {
        gets.push(value);
        return done ? { kind: 'operation', operation: completed } : { kind: 'unverifiable' };
      },
    },
  });
  controller.restart('worker-1');
  await flush();
  clock.advance(999);
  await flush();
  assert.equal(gets.length, 0);
  clock.advance(1);
  await flush();
  assert.equal(gets.length, 1);
  for (let count = 0; count < 29; count++) {
    clock.advance(1_000);
    await flush();
  }
  assert.deepEqual(controller.getSnapshot(), { phase: 'unverifiable', request });
  assert.equal(gets.length, 29);
  assert.equal(clock.size(), 0);
  controller.restart('worker-1');
  assert.equal(posts, 1);
  done = true;
  controller.recheck();
  await flush();
  assert.equal(posts, 1);
  assert.deepEqual(gets[29], request);
  assert.deepEqual(controller.getSnapshot(), { phase: 'completed', request, operation: completed });
  controller.dispose();
});

test('409は監視再取得だけを行い、自動再送せず終了する', async () => {
  const clock = timers();
  let refreshed = 0;
  let posts = 0;
  const controller = createWeatherRestartController({
    ...clock,
    requestIdFactory: () => 'restart-1',
    onRefresh: () => refreshed++,
    client: {
      restart: async () => {
        posts++;
        return { kind: 'conflict' };
      },
      find: async () => {
        throw new Error('照会不要');
      },
    },
  });
  controller.restart('worker-1');
  await flush();
  clock.advance(60_000);
  assert.deepEqual(controller.getSnapshot(), { phase: 'conflict', request });
  assert.equal(posts, 1);
  assert.equal(refreshed, 1);
  assert.equal(clock.size(), 0);
});

test('APIは他ID・他role・履歴記録フラグの欠落を正常応答としない', () => {
  assert.deepEqual(parseWeatherRestartReply(200, completed, 'restart-1'), {
    kind: 'operation',
    operation: completed,
  });
  for (const body of [
    { ...completed, requestId: 'other' },
    { ...completed, role: 'delivery' },
    { ...completed, historyRecorded: undefined },
  ]) {
    assert.deepEqual(parseWeatherRestartReply(200, body, 'restart-1'), { kind: 'unverifiable' });
  }
});

test('APIはPOST内容と同ID照会・専用履歴のURLを送信し、未記録履歴を拒否する', async () => {
  const calls: { url: string; body: unknown }[] = [];
  const client = createWeatherWorkerClient({
    fetch: (async (url, init) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify(completed), { status: 200 });
    }) as typeof fetch,
  });
  const signal = new AbortController().signal;
  await client.restart(request, signal);
  await client.find(request, signal);
  assert.deepEqual(calls, [
    { url: '/api/control/weather-workers/acquisition/restart', body: request },
    { url: '/api/control/weather-workers/operations/restart-1', body: null },
  ]);
  await assert.rejects(client.history(21, signal), { message: '再開履歴の応答形式が不正です' });
  assert.deepEqual(calls[2], {
    url: '/api/monitoring/weather-worker-operations?limit=20&beforeId=21',
    body: null,
  });
});

test('Worker状態・成功と準備の区別・履歴未記録を明示する', () => {
  const runtime = fixture.weatherRuntimes.acquisition;
  assert.equal(
    weatherWorkerLabel({ ...runtime, lifecycle: 'failed', reportFreshness: 'fresh' }),
    'Worker異常',
  );
  assert.equal(weatherWorkerLabel({ ...runtime, reportFreshness: 'unknown' }), '報告待ち');
  assert.equal(
    weatherWorkerLabel({ ...runtime, reportFreshness: 'stale' }),
    '応答を確認できません',
  );
  assert.equal(weatherRestartResult(completed), '取得Workerを再開しました');
  assert.equal(
    weatherRestartResult(completed, {
      ...fixture,
      readiness: { ...fixture.readiness, initialFetchPhase: 'failed' },
    }),
    '取得Workerを再開しました。気象情報の準備に失敗しています',
  );
  assert.equal(
    weatherRestartResult({ ...completed, historyRecorded: false }),
    '取得Workerを再開しました（履歴未記録）',
  );
  assert.equal(
    weatherRestartResult(completed, {
      ...fixture,
      readiness: { ...fixture.readiness, initialFetchPhase: 'running' },
    }),
    '取得Workerを再開しました。気象情報は準備中です',
  );
  assert.equal(
    weatherRestartResult(
      { ...completed, desiredRunning: false },
      {
        ...fixture,
        operation: { ...fixture.operation, schedulerRunning: false },
        readiness: { ...fixture.readiness, initialFetchPhase: 'completed' },
      },
    ),
    '取得Workerを再開しました。取得は停止したままです',
  );
});

test('専用ボタンは不明・準備中・再開中では無効、freshな異常でもサーバー許可時に有効', () => {
  const runtime = fixture.weatherRuntimes.acquisition;
  for (const [lifecycle, freshness, allowed, expectedDisabled] of [
    ['starting', 'unknown', false, true],
    ['starting', 'fresh', false, true],
    ['ready', 'fresh', false, true],
    ['restarting', 'fresh', false, true],
    ['failed', 'fresh', true, false],
    ['failed', 'unknown', true, false],
    ['stopped', 'stale', true, false],
    ['ready', 'stale', true, false],
  ] as const) {
    const data = {
      ...fixture,
      weatherRuntimes: {
        ...fixture.weatherRuntimes,
        acquisition: { ...runtime, lifecycle, reportFreshness: freshness, restartAllowed: allowed },
      },
    };
    const html = renderToStaticMarkup(
      React.createElement(WeatherWorkerPanel, { data, unavailable: false }),
    );
    // ラッパーの属性だけを抽出し、他sectionの文言には依存しない。
    const attributes = html.match(/<md-gb-button([^>]*)>/)?.[1] ?? '';
    assert.equal(/disabled=""/.test(attributes), expectedDisabled);
    assert.equal(
      html.match(/<p class="monitoring-worker-result"[^>]*>/)?.[0],
      '<p class="monitoring-worker-result" aria-live="polite" role="status">',
    );
    assert.equal(html.match(/<summary>(.*?)<\/summary>/)?.[1], '再開履歴');
  }
});

test('旧世代の未完了scopeを実行中へ戻さず結果不明として表示する', () => {
  const data = {
    ...fixture,
    weatherRuntimes: {
      ...fixture.weatherRuntimes,
      acquisition: { ...fixture.weatherRuntimes.acquisition, unknownScopes: ['east', 'trc'] },
    },
  };
  const html = renderToStaticMarkup(
    React.createElement(WeatherWorkerPanel, { data, unavailable: false }),
  );
  assert.equal(html.match(/<p>結果不明: (.*?)<\/p>/)?.[1], 'east、trc');
});
