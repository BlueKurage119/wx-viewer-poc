import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { flushSync } from 'react-dom';
import { buildEarlyWarningFixtureResponse } from '../src/map/panels/earlyWarning/earlyWarningFixture.ts';
import {
  resolvePanelControlStatus,
  useTrainingOverlayCards,
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
  options: {
    readonly initialFailure?: boolean;
    readonly metadataStale?: boolean;
    /** 通常表示に重ねる訓練カードの hook だけを描画する（enabled はその値）。 */
    readonly overlay?: { readonly enabled: boolean };
    /** useWeatherDangerData の enabled。 */
    readonly dangerEnabled?: boolean;
  } = {},
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
    const requestedStatus = url.searchParams.get('controlStatus') ?? controlStatus;
    const context = {
      terminalId,
      venueId: 'east',
      controlStatus: requestedStatus,
      isTraining: requestedStatus === 'training',
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
  let overlay: ReturnType<typeof useTrainingOverlayCards> | undefined;
  function OverlayComponent() {
    overlay = useTrainingOverlayCards({ terminalId, enabled: options.overlay!.enabled });
    return null;
  }
  function DangerComponent() {
    data = useWeatherDangerData({
      terminalId,
      controlStatus,
      nowMs,
      fixtureEnvironment: environment,
      enabled: options.dangerEnabled,
    });
    return null;
  }
  const TestComponent = options.overlay ? OverlayComponent : DangerComponent;
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(element as unknown as Element);
  act(() => flushSync(() => root.render(el(TestComponent))));
  return {
    fetches,
    timers,
    get data() {
      return data;
    },
    get overlay() {
      return overlay;
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

const pathsOf = (fetches: readonly { url: string }[]) =>
  fetches.map(({ url }) => new URL(url, 'https://example.invalid'));

test('resolvePanelControlStatus: K端末で ?controlStatus=training のときだけ training', () => {
  assert.equal(resolvePanelControlStatus('?controlStatus=training', 'K'), 'training');
  assert.equal(resolvePanelControlStatus('?controlStatus=training', 'H'), 'normal');
  assert.equal(resolvePanelControlStatus('', 'K'), 'normal');
  assert.equal(resolvePanelControlStatus('?controlStatus=test', 'K'), 'normal');
  assert.equal(resolvePanelControlStatus('?controlStatus=normal', 'K'), 'normal');
  assert.equal(resolvePanelControlStatus('?controlStatus=Training', 'K'), 'normal');
});

test('パネルの訓練切替: controlStatus=training で3 APIとも training を要求し、enabled=false では取得しない', async () => {
  const off = await mountDanger({ isDev: true, search: '' }, { dangerEnabled: false });
  try {
    await flushEffects();
    assert.equal(off.fetches.length, 0);
  } finally {
    off.cleanup();
  }
  const on = await mountDanger({ isDev: true, search: '' });
  try {
    on.update({ controlStatus: 'training' });
    await flushEffects();
    const training = pathsOf(on.fetches).filter(
      (url) => url.searchParams.get('controlStatus') === 'training',
    );
    assert.deepEqual(training.map((url) => url.pathname).sort(), [
      '/api/weather/bulletins',
      '/api/weather/early-warning',
      '/api/weather/warnings',
    ]);
    assert.equal(on.data?.panels.warning[0]?.isTraining, true);
  } finally {
    on.cleanup();
  }
});

test('訓練の重ね表示: 通常表示では警報・注意報と気象防災速報だけを training で要求し、警報は訓練カードとして別に返す', async () => {
  const harness = await mountDanger({ isDev: true, search: '' }, { overlay: { enabled: true } });
  try {
    await flushEffects();
    const urls = pathsOf(harness.fetches);
    assert.deepEqual(urls.map((u) => u.pathname).sort(), [
      '/api/weather/bulletins',
      '/api/weather/warnings',
    ]);
    assert.ok(urls.every((u) => u.searchParams.get('controlStatus') === 'training'));
    const cards = harness.overlay!.warning;
    assert.equal(cards.length, 1);
    assert.equal(cards[0]!.isTraining, true);
    assert.equal(cards[0]!.trainingOverlay, true);
    assert.equal(cards[0]!.heading, undefined, '見出しは既定のパネル名（警報・注意報）');
    assert.match(cards[0]!.key, /^training-overlay-/);
    assert.deepEqual(harness.overlay!.bosaiBulletin, []);
  } finally {
    harness.cleanup();
  }
});

test('訓練の重ね表示: 訓練の発表中が0件・取得失敗ではカードを出さず、無効化中は取得しない', async () => {
  const empty = await mountDanger({ isDev: true, search: '' }, { overlay: { enabled: true } });
  try {
    await flushEffects();
    assert.equal(empty.overlay!.warning.length, 1);
    empty.clearResponses();
    await empty.advanceOnePeriod();
    await flushEffects();
    assert.deepEqual(empty.overlay!.warning, []);
  } finally {
    empty.cleanup();
  }
  const failed = await mountDanger(
    { isDev: true, search: '' },
    { overlay: { enabled: true }, initialFailure: true },
  );
  try {
    await flushEffects();
    assert.deepEqual(failed.overlay!.warning, []);
    assert.deepEqual(failed.overlay!.bosaiBulletin, []);
  } finally {
    failed.cleanup();
  }
  const disabled = await mountDanger({ isDev: true, search: '' }, { overlay: { enabled: false } });
  try {
    await flushEffects();
    assert.equal(disabled.fetches.length, 0);
    assert.deepEqual(disabled.overlay!.warning, []);
  } finally {
    disabled.cleanup();
  }
});
