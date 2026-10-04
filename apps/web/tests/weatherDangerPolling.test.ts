import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { flushSync } from 'react-dom';
import { buildEarlyWarningFixtureResponse } from '../src/map/panels/earlyWarning/earlyWarningFixture.ts';
import {
  useWeatherDangerData,
  type WeatherDangerData,
} from '../src/weather/useWeatherDangerData.ts';
import type { WeatherControlStatus } from '@wx-viewer-poc/shared';
import type { EarlyWarningFixtureEnvironment } from '../src/map/panels/earlyWarning/earlyWarningFixtureGate.ts';

const el = React.createElement;
(globalThis as typeof globalThis & { React: typeof React }).React = React;

async function flushEffects(): Promise<void> {
  // Reactの更新キューと、その中から起動する非同期取得の完了を待つ。
  await act(async () => {
    await Promise.resolve();
  });
}

async function mountDanger(
  environment: EarlyWarningFixtureEnvironment,
  options: { readonly initialFailure?: boolean; readonly metadataStale?: boolean } = {},
) {
  const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const originalActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalLocation = globalThis.window.location;
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const documentForClient = {
    addEventListener() {},
    removeEventListener() {},
    createElement() {
      return { style: {}, setAttribute() {}, removeAttribute() {} };
    },
    visibilityState: 'visible',
    documentElement: null as unknown as object,
    defaultView: globalThis.window,
    activeElement: null,
  };
  const element = {
    nodeType: 1,
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument: documentForClient,
    addEventListener() {},
    removeEventListener() {},
  };
  documentForClient.documentElement = element;
  (globalThis as unknown as { document: typeof documentForClient }).document = documentForClient;
  Object.assign(globalThis.window, {
    HTMLIFrameElement: class {},
    location: { search: environment.search },
  });

  const timers: { callback: () => void; delay: number; cleared: boolean }[] = [];
  globalThis.setTimeout = ((callback: () => void, delay?: number) => {
    if (delay !== 60_000) return originalSetTimeout(callback, delay);
    const timer = { callback, delay, cleared: false };
    timers.push(timer);
    return timer as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
    const timer = timers.find((item) => item === (id as unknown));
    if (timer) timer.cleared = true;
    else originalClearTimeout(id);
  }) as typeof clearTimeout;

  const fetches: { url: string; signal: AbortSignal }[] = [];
  const response = buildEarlyWarningFixtureResponse(Date.parse('2026-09-28T03:00:00Z'));
  const body = options.metadataStale
    ? {
        ...response,
        near: {
          ...response.near,
          metadata: { ...response.near.metadata, availability: 'stale' as const },
        },
      }
    : response;
  let failFetch = options.initialFailure ?? false;
  let terminalId = 'test-terminal';
  let controlStatus: WeatherControlStatus = 'normal';
  let nowMs = Date.parse('2026-09-28T03:00:00Z');
  let empty = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetches.push({ url: String(input), signal: init?.signal as AbortSignal });
    if (failFetch) throw new Error('通信失敗');
    const url = new URL(String(input), 'https://example.invalid');
    const context = {
      terminalId,
      venueId: 'east',
      controlStatus,
      isTraining: controlStatus === 'training',
      evaluatedAt: '2026-09-28T03:00:00Z',
    };
    const payload = url.pathname.endsWith('/warnings')
      ? {
          ...context,
          area: response.near.area,
          metadata: response.near.metadata,
          data: empty
            ? null
            : {
                items: [
                  {
                    sequence: 0,
                    kindCode: '33',
                    kindName: '大雨特別警報',
                    kindStatus: '継続',
                    lastKindCode: null,
                    lastKindName: null,
                    kindIssuedAt: null,
                    sourceTelegram: 'test',
                  },
                ],
              },
          capabilities: {
            unsupportedKindCodes: ['04', '18'],
            supplementSource: 'warning-timeseries',
          },
        }
      : url.pathname.endsWith('/bulletins')
        ? {
            ...context,
            area: response.near.area,
            availability: 'available',
            bulletins: [],
            capabilities: {},
          }
        : {
            ...body,
            ...context,
            ...(empty
              ? { near: { ...body.near, data: null }, far: { ...body.far, data: null } }
              : {}),
          };
    return { ok: true, json: async () => payload } as Response;
  }) as typeof fetch;

  let data: WeatherDangerData | undefined;
  function TestComponent() {
    data = useWeatherDangerData({
      terminalId,
      controlStatus,
      nowMs,
      fixtureEnvironment: environment,
    });
    return null;
  }
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(element as unknown as Element);
  act(() => flushSync(() => root.render(el(TestComponent))));
  return {
    fetches,
    timers,
    get data() {
      return data;
    },
    update(params: { terminalId?: string; controlStatus?: WeatherControlStatus; nowMs?: number }) {
      terminalId = params.terminalId ?? terminalId;
      controlStatus = params.controlStatus ?? controlStatus;
      nowMs = params.nowMs ?? nowMs;
      act(() => flushSync(() => root.render(el(TestComponent))));
    },
    clearResponses() {
      empty = true;
    },
    setFetchFailure(value: boolean) {
      failFetch = value;
    },
    async advanceOnePeriod() {
      await act(async () => {
        for (const timer of timers.filter((item) => !item.cleared)) {
          timer.cleared = true;
          timer.callback();
        }
      });
    },
    cleanup() {
      act(() => root.unmount());
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
      globalThis.fetch = originalFetch;
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      (globalThis as unknown as { document: typeof originalDocument }).document = originalDocument;
      (globalThis as unknown as { window: typeof originalWindow }).window = originalWindow;
      Object.assign(globalThis.window, { location: originalLocation });
    },
  };
}

test('共有取得は3 APIを各1回呼び、時計更新では追加取得しない', async () => {
  const harness = await mountDanger({ isDev: true, search: '' });
  try {
    assert.equal(harness.data?.level, null);
    await flushEffects();
    assert.deepEqual(
      harness.fetches.map(({ url }) => new URL(url, 'https://example.invalid').pathname).sort(),
      ['/api/weather/bulletins', '/api/weather/early-warning', '/api/weather/warnings'],
    );
    assert.equal(harness.data?.level, 5);
    assert.equal(harness.data?.panels.warning.length, 1);
    harness.update({ nowMs: Date.parse('2026-09-28T03:00:01Z') });
    await flushEffects();
    assert.equal(harness.fetches.length, 3);
    await harness.advanceOnePeriod();
    assert.equal(harness.fetches.length, 6);
  } finally {
    harness.cleanup();
  }
});

test('取得失敗でも共有ドットとパネルの保持値をstaleとして維持する', async () => {
  const harness = await mountDanger({ isDev: true, search: '' });
  try {
    await flushEffects();
    const before = harness.data?.panels.warning[0];
    assert.equal(before?.status.kind, 'data');
    harness.setFetchFailure(true);
    await harness.advanceOnePeriod();
    assert.equal(harness.fetches.length, 6);
    assert.equal(harness.data?.level, 5);
    assert.deepEqual(harness.data?.panels.warning[0]?.status, {
      ...before?.status,
      availability: 'stale',
    });
    assert.equal(harness.data?.panels.earlyWarning.status.kind, 'data');
    if (harness.data?.panels.earlyWarning.status.kind === 'data')
      assert.equal(harness.data.panels.earlyWarning.status.availability, 'stale');
  } finally {
    harness.cleanup();
  }
});

test('初回失敗と空の成功応答は前回ドットを復活させない', async () => {
  const harness = await mountDanger({ isDev: true, search: '' }, { initialFailure: true });
  try {
    await flushEffects();
    assert.equal(harness.data?.level, null);
    assert.equal(harness.data?.panels.earlyWarning.status.kind, 'failed');
  } finally {
    harness.cleanup();
  }
  const ready = await mountDanger({ isDev: true, search: '' });
  try {
    await flushEffects();
    assert.equal(ready.data?.level, 5);
    ready.clearResponses();
    await ready.advanceOnePeriod();
    assert.equal(ready.data?.level, null);
    assert.equal(ready.data?.panels.warning.length, 0);
  } finally {
    ready.cleanup();
  }
});

test('端末とcontrolStatus切替は前端末・前モードの保持値を消し、要求先を更新する', async () => {
  for (const update of [{ terminalId: 'other-terminal' }, { controlStatus: 'training' as const }]) {
    const harness = await mountDanger({ isDev: true, search: '' });
    try {
      await flushEffects();
      assert.equal(harness.data?.level, 5);
      harness.setFetchFailure(true);
      harness.update(update);
      await flushEffects();
      assert.equal(harness.data?.level, null);
      assert.equal(harness.data?.panels.earlyWarning.status.kind, 'failed');
      assert.equal(harness.fetches.length, 6);
      for (const { url } of harness.fetches.slice(3)) {
        const query = new URL(url, 'https://example.invalid').searchParams;
        assert.equal(query.get('terminalId'), update.terminalId ?? 'test-terminal');
        assert.equal(query.get('controlStatus'), update.controlStatus ?? 'normal');
      }
    } finally {
      harness.cleanup();
    }
  }
});

test('early-warning開発fixtureは共有後も早期注意APIを停止し、他2 APIは維持する', async () => {
  const harness = await mountDanger({ isDev: true, search: '?panelFixture=early-warning' });
  try {
    await flushEffects();
    assert.deepEqual(
      harness.fetches.map(({ url }) => new URL(url, 'https://example.invalid').pathname).sort(),
      ['/api/weather/bulletins', '/api/weather/warnings'],
    );
    await harness.advanceOnePeriod();
    assert.equal(harness.fetches.length, 4);
  } finally {
    harness.cleanup();
  }
});
