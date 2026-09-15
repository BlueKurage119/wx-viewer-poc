import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchTileCatalog } from '../src/api/tileCatalogClient.ts';

test('tileCatalogClient: 正常取得時にパース結果を返す', async () => {
  let capturedUrl = '';
  const mockFetch: typeof fetch = async (input) => {
    capturedUrl = String(input);
    return new Response(JSON.stringify({ testData: 'hello' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const controller = new AbortController();
  const res = await fetchTileCatalog({
    path: '/api/weather/nowcast/times',
    terminalId: 'hkeagh01',
    controlStatus: 'normal',
    signal: controller.signal,
    parse: (body) => (body as { testData: string }).testData,
    fetchImpl: mockFetch,
  });

  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value, 'hello');
  }

  // URL とクエリの確認
  const url = new URL(capturedUrl, 'http://localhost');
  assert.equal(url.pathname, '/api/weather/nowcast/times');
  assert.equal(url.searchParams.get('terminalId'), 'hkeagh01');
  assert.equal(url.searchParams.get('controlStatus'), 'normal');
  assert.equal(Array.from(url.searchParams.keys()).length, 2);
});

test('tileCatalogClient: ネットワーク障害時に failure={kind: "network"} を返す', async () => {
  const mockFetch: typeof fetch = async () => {
    throw new Error('Connection refused');
  };

  const controller = new AbortController();
  const res = await fetchTileCatalog({
    path: '/api/weather/nowcast/times',
    terminalId: 'hkeagh01',
    controlStatus: 'normal',
    signal: controller.signal,
    parse: () => ({}),
    fetchImpl: mockFetch,
  });

  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.failure.kind, 'network');
  }
});

test('tileCatalogClient: HTTP エラー時にステータスとエラーコードを返す', async () => {
  const mockFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        status: 'error',
        code: 'terminal_not_found',
      }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const controller = new AbortController();
  const res = await fetchTileCatalog({
    path: '/api/weather/nowcast/times',
    terminalId: 'unknown',
    controlStatus: 'normal',
    signal: controller.signal,
    parse: () => ({}),
    fetchImpl: mockFetch,
  });

  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.failure.kind, 'http');
    if (res.failure.kind === 'http') {
      assert.equal(res.failure.httpStatus, 404);
      assert.equal(res.failure.code, 'terminal_not_found');
    }
  }
});
