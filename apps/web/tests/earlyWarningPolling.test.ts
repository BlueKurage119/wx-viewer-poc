import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { flushSync } from 'react-dom';
import { buildEarlyWarningFixtureResponse } from '../src/map/panels/earlyWarning/earlyWarningFixture.ts';
import { useEarlyWarning } from '../src/map/panels/earlyWarning/useEarlyWarning.tsx';
import type { EarlyWarningFixtureEnvironment } from '../src/map/panels/earlyWarning/earlyWarningFixtureGate.ts';
import type { InfoPanelCardInput } from '../src/map/panels/panelDefinitions.ts';

const el = React.createElement;
(globalThis as typeof globalThis & { React: typeof React }).React = React;

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

async function mountEarlyWarning(environment: EarlyWarningFixtureEnvironment) {
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
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetches.push({ url: String(input), signal: init?.signal as AbortSignal });
    return {
      ok: true,
      json: async () => ({ ...response, terminalId: 'test-terminal' }),
    } as Response;
  }) as typeof fetch;

  let card: InfoPanelCardInput | undefined;
  function TestComponent() {
    card = useEarlyWarning({
      terminalId: 'test-terminal',
      controlStatus: 'normal',
      fixtureEnvironment: { isDev: environment.isDev },
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

test('Issue #56 AC-16: 開発用 early-warning fixture は実 hook effect と1周期後も警報級 API 呼び出し0件', async () => {
  const harness = await mountEarlyWarning({ isDev: true, search: '?panelFixture=early-warning' });
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

test('Issue #56 AC-16: 他 fixture・クエリなし・本番相当は初回と周期後に警報級 API を呼ぶ', async () => {
  for (const environment of [
    { isDev: true, search: '?panelFixture=warning-timeseries' },
    { isDev: true, search: '' },
    { isDev: false, search: '?panelFixture=early-warning' },
  ]) {
    const harness = await mountEarlyWarning(environment);
    try {
      await flushEffects();
      assert.equal(harness.fetches.length, 1);
      assert.match(harness.fetches[0]?.url ?? '', /^\/api\/weather\/early-warning\?/);
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
