import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReactNode } from 'react';
import { createEntryBootstrap } from '../src/entryBootstrap.tsx';
import { testVenueRegistry } from './venueConfigPreload.ts';

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

test('起動と再試行で同じ React root を再利用し、読み込み・通信失敗・不正応答・成功を表示する', async () => {
  const rendered: ReactNode[] = [];
  let createRootCalls = 0;
  const responses: Array<() => Promise<Response>> = [
    async () => {
      throw new Error('network unavailable');
    },
    async () => new Response(JSON.stringify(validVenueConfig)),
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
      '会場設定を読み込んでいます',
      '会場設定の通信に失敗しました',
      '会場設定を読み込んでいます',
      'アプリ本体',
      '会場設定を読み込んでいます',
      '会場設定の応答が不正です',
    ],
  );
});
