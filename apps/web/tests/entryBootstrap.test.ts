import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReactNode } from 'react';
import { createEntryBootstrap } from '../src/entryBootstrap.tsx';
import { testTerminalRegistry, testVenueRegistry } from './venueConfigPreload.ts';

interface RenderedEntry {
  readonly message: string;
  readonly retry: (() => void) | undefined;
}

function getRenderedEntry(node: ReactNode): RenderedEntry | null {
  if (node === null || typeof node !== 'object' || !('props' in node)) return null;
  const props = node.props as { children?: ReactNode };
  const children = props.children;
  if (!Array.isArray(children)) return null;
  const [heading, retryButton] = children;
  if (heading === null || typeof heading !== 'object' || !('props' in heading)) return null;
  const headingProps = heading.props as { children?: ReactNode };
  if (typeof headingProps.children !== 'string') return null;
  if (retryButton === null || typeof retryButton !== 'object' || !('props' in retryButton)) {
    return { message: headingProps.children, retry: undefined };
  }
  const retryProps = retryButton.props as { onClick?: () => void };
  return { message: headingProps.children, retry: retryProps.onClick };
}

const validVenueConfig = {
  generation: testVenueRegistry.generation,
  venues: testVenueRegistry.listVenues(),
};
const validTerminalConfig = {
  generation: testTerminalRegistry.generation,
  venueGeneration: testVenueRegistry.generation,
  terminals: testTerminalRegistry.listTerminals(),
};

test('起動と再試行で同じ React root を再利用し、読み込み・通信失敗・不正応答・成功を表示する', async () => {
  const rendered: ReactNode[] = [];
  let createRootCalls = 0;
  const responses: Array<() => Promise<Response>> = [
    async () => {
      throw new Error('network unavailable');
    },
    async () => new Response(JSON.stringify(validVenueConfig)),
    async () => new Response(JSON.stringify(validTerminalConfig)),
    async () => new Response('{'),
  ];
  const bootstrap = createEntryBootstrap({} as Element, {
    createRoot: () => {
      createRootCalls++;
      return { render: (node) => rendered.push(node) };
    },
    fetch: async () => {
      const next = responses.shift();
      if (!next) throw new Error('unexpected request');
      return next();
    },
    renderApplication: () => 'アプリ本体',
  });

  await bootstrap();
  const failure = getRenderedEntry(rendered.at(-1)!);
  assert.equal(failure?.message, '会場設定の通信に失敗しました');
  assert.ok(failure?.retry);

  failure.retry();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await bootstrap();

  assert.equal(createRootCalls, 1);
  assert.deepEqual(
    rendered.map((node) => getRenderedEntry(node)?.message ?? 'アプリ本体'),
    [
      '設定を読み込んでいます',
      '会場設定の通信に失敗しました',
      '設定を読み込んでいます',
      'アプリ本体',
      '設定を読み込んでいます',
      '会場設定の応答が不正です',
    ],
  );
});

test('世代不一致なら両設定を再取得し、一致した設定だけで描画する', async () => {
  const rendered: ReactNode[] = [];
  const paths: string[] = [];
  const responses = [
    validVenueConfig,
    { ...validTerminalConfig, venueGeneration: '0'.repeat(64) },
    validVenueConfig,
    validTerminalConfig,
  ];
  const bootstrap = createEntryBootstrap({} as Element, {
    createRoot: () => ({ render: (node) => rendered.push(node) }),
    fetch: async (input) => {
      paths.push(String(input));
      return new Response(JSON.stringify(responses.shift()));
    },
    renderApplication: () => 'アプリ本体',
  });
  await bootstrap();
  assert.deepEqual(paths, [
    '/api/config/venues',
    '/api/config/terminals',
    '/api/config/venues',
    '/api/config/terminals',
  ]);
  assert.equal(rendered.at(-1), 'アプリ本体');
});

test('再取得後も世代不一致ならアプリを描画しない', async () => {
  const rendered: ReactNode[] = [];
  const responses = [validVenueConfig, validTerminalConfig, validVenueConfig, validTerminalConfig];
  const bootstrap = createEntryBootstrap({} as Element, {
    createRoot: () => ({ render: (node) => rendered.push(node) }),
    fetch: async (input) => {
      const body = responses.shift()!;
      return new Response(
        JSON.stringify(
          String(input).endsWith('/terminals')
            ? { ...body, venueGeneration: '0'.repeat(64) }
            : body,
        ),
      );
    },
    renderApplication: () => 'アプリ本体',
  });
  await bootstrap();
  assert.equal(getRenderedEntry(rendered.at(-1)!)?.message, '設定の世代が一致しません');
});
