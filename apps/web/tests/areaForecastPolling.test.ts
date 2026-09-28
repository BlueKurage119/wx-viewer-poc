import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { flushSync } from 'react-dom';
import { buildAreaForecastFixtureResponse } from '../src/map/panels/areaForecast/areaForecastFixture.ts';
import { useAreaForecast } from '../src/map/panels/areaForecast/useAreaForecast.tsx';
import type { AreaForecastFixtureEnvironment } from '../src/map/panels/areaForecast/areaForecastFixtureGate.ts';
import type { InfoPanelCardInput } from '../src/map/panels/panelDefinitions.ts';

const el = React.createElement;
(globalThis as typeof globalThis & { React: typeof React }).React = React;

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

async function mountAreaForecast(
  environment: AreaForecastFixtureEnvironment,
  options: { readonly initialFailure?: boolean; readonly metadataStale?: boolean } = {},
) {
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
  const response = buildAreaForecastFixtureResponse(Date.parse('2026-09-28T03:00:00Z'));
  const body = options.metadataStale
    ? {
        ...response,
        metadata: { ...response.metadata, availability: 'stale' as const },
      }
    : response;
  let failFetch = options.initialFailure ?? false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetches.push({ url: String(input), signal: init?.signal as AbortSignal });
    if (failFetch) throw new Error('通信失敗');
    return {
      ok: true,
      json: async () => ({ ...body, terminalId: 'test-terminal' }),
    } as Response;
  }) as typeof fetch;

  let card: InfoPanelCardInput | undefined;
  function TestComponent() {
    card = useAreaForecast({
      terminalId: 'test-terminal',
      controlStatus: 'normal',
      fixtureEnvironment: { isDev: environment.isDev, search: environment.search },
    });
    return null;
  }
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(element as unknown as Element);
  flushSync(() => root.render(el(TestComponent)));
  return {
    fetches,
    timers,
    get card() {
      return card;
    },
    setFetchFailure(value: boolean) {
      failFetch = value;
    },
    async advanceOnePeriod() {
      const timer = timers.find((item) => !item.cleared);
      if (timer) {
        timer.cleared = true;
        timer.callback();
      }
      await flushEffects();
    },
    cleanup() {
      root.unmount();
      globalThis.fetch = originalFetch;
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      (globalThis as unknown as { document: typeof originalDocument }).document = originalDocument;
      (globalThis as unknown as { window: typeof originalWindow }).window = originalWindow;
      Object.assign(globalThis.window, { location: originalLocation });
    },
  };
}

test('Issue #58 AC-14: 開発用 area-forecast fixture は実 hook effect と1周期後も API 呼び出し0件', async () => {
  const harness = await mountAreaForecast({ isDev: true, search: '?panelFixture=area-forecast' });
  try {
    await flushEffects();
    assert.equal(harness.fetches.length, 0);
    assert.equal(harness.timers.filter((timer) => !timer.cleared).length, 0);
    await harness.advanceOnePeriod();
    assert.equal(harness.fetches.length, 0);
  } finally {
    harness.cleanup();
  }
});

test('Issue #58: 成功後の通信失敗で前回値を保持し、カードを stale にする', async () => {
  const harness = await mountAreaForecast({ isDev: true, search: '' });
  try {
    assert.equal(harness.card?.status.kind, 'loading');
    await flushEffects();
    assert.equal(harness.card?.status.kind, 'data');
    assert.equal(harness.card.status.availability, 'available');
    const ready = harness.card;
    const retainedResponse = (ready.content as React.ReactElement).props.response;
    harness.setFetchFailure(true);
    await harness.advanceOnePeriod();
    assert.equal(harness.fetches.length, 2);
    assert.equal(harness.card?.status.kind, 'data');
    assert.equal(harness.card.status.availability, 'stale');
    assert.equal(harness.card.status.time, ready.status.time);
    assert.equal((harness.card.content as React.ReactElement).props.response, retainedResponse);
  } finally {
    harness.cleanup();
  }
});

test('Issue #58: metadata stale、初回失敗、loading のカード状態を維持する', async () => {
  const metadataHarness = await mountAreaForecast(
    { isDev: true, search: '' },
    { metadataStale: true },
  );
  try {
    assert.equal(metadataHarness.card?.status.kind, 'loading');
    await flushEffects();
    assert.equal(metadataHarness.card?.status.kind, 'data');
    assert.equal(metadataHarness.card.status.availability, 'stale');
  } finally {
    metadataHarness.cleanup();
  }
  const failedHarness = await mountAreaForecast(
    { isDev: true, search: '' },
    { initialFailure: true },
  );
  try {
    assert.equal(failedHarness.card?.status.kind, 'loading');
    await flushEffects();
    assert.equal(failedHarness.card?.status.kind, 'failed');
    assert.equal(failedHarness.card.content, undefined);
  } finally {
    failedHarness.cleanup();
  }
});

test('Issue #58 AC-14: 他 fixture・クエリなし・本番相当は初回と周期後に地域時系列 API を呼ぶ', async () => {
  for (const environment of [
    { isDev: true, search: '?panelFixture=early-warning' },
    { isDev: true, search: '' },
    { isDev: false, search: '?panelFixture=area-forecast' },
  ]) {
    const harness = await mountAreaForecast(environment);
    try {
      await flushEffects();
      assert.equal(harness.fetches.length, 1);
      assert.match(harness.fetches[0]?.url ?? '', /^\/api\/weather\/area-timeseries\?/);
      assert.equal(harness.card?.heading, undefined);
      assert.equal(harness.card?.status.kind, 'data');
      assert.deepEqual(
        harness.timers.filter((timer) => !timer.cleared).map((timer) => timer.delay),
        [60_000],
      );
      await harness.advanceOnePeriod();
      assert.equal(harness.fetches.length, 2);
    } finally {
      harness.cleanup();
    }
  }
});
