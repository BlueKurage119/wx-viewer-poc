import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { loadVenueConfig } from '../src/config/venueConfigLoader.js';
import {
  loadTerminalConfig,
  validateLocalTerminalConfig,
  validateTerminalConfig,
} from '../src/config/terminalConfigLoader.js';

const venueRegistry = loadVenueConfig({ environment: 'production' }).registry;
const base = 'terminals:\n  - id: h1\n    name: 端末H1\n    mode: H\n    venueId: east\n';
function withFiles(
  baseContent: string,
  localContent: string | undefined,
  run: (baseUrl: URL, localUrl: URL) => void,
): void {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-config-loader-'));
  const basePath = path.join(directory, 'terminals.yaml');
  const localPath = path.join(directory, 'terminals.local.yaml');
  try {
    fs.writeFileSync(basePath, baseContent);
    if (localContent !== undefined) fs.writeFileSync(localPath, localContent);
    run(pathToFileURL(basePath), pathToFileURL(localPath));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('共有 YAML は既存4端末を順序どおり読み込む', () => {
  const loaded = loadTerminalConfig({ venueRegistry, environment: 'production' });
  assert.deepEqual(
    loaded.registry.listTerminals().map((terminal) => terminal.id),
    ['hkeagh01', 'kkeagh01', 'htrcph01', 'ktrcph01'],
  );
  assert.equal(loaded.response.venueGeneration, venueRegistry.generation);
  assert.equal(loaded.response.generation.length, 64);
  assert.equal(loaded.registry.resolveTerminal('missing'), null);
  assert.ok(Object.isFrozen(loaded.registry.listTerminals()));
  assert.ok(Object.isFrozen(loaded.registry.listTerminals()[0]));
});

test('ローカル差分は ID ごとに上書き・追加し、本番では無効', () => {
  const local =
    'terminals:\n  - id: h1\n    name: 端末H2\n  - id: k1\n    name: 端末K1\n    mode: K\n    venueId: trc\n';
  withFiles(base, local, (baseUrl, localUrl) => {
    const development = loadTerminalConfig({
      baseUrl,
      localUrl,
      environment: 'development',
      venueRegistry,
    });
    assert.equal(development.localOverride, 'applied');
    assert.deepEqual(
      development.registry.listTerminals().map((terminal) => terminal.name),
      ['端末H2', '端末K1'],
    );
    const production = loadTerminalConfig({
      baseUrl,
      localUrl,
      environment: 'production',
      venueRegistry,
    });
    assert.equal(production.localOverride, 'disabled-production');
    assert.deepEqual(
      production.registry.listTerminals().map((terminal) => terminal.name),
      ['端末H1'],
    );
  });
  withFiles(base, undefined, (baseUrl, localUrl) => {
    assert.equal(
      loadTerminalConfig({ baseUrl, localUrl, environment: 'development', venueRegistry })
        .localOverride,
      'absent',
    );
  });
});

test('共有設定のスキーマ違反を拒否する', () => {
  const terminal = { id: 'h1', name: '端末H1', mode: 'H', venueId: 'east' };
  const cases: readonly [unknown, RegExp][] = [
    [{ terminal: [terminal] }, /root\.terminal/],
    [{ terminals: [] }, /terminals/],
    [{ terminals: [{ ...terminal, name: undefined }] }, /terminals\[0\]\.name/],
    [{ terminals: [{ ...terminal, unknown: true }] }, /terminals\[0\]\.unknown/],
    [{ terminals: [{ ...terminal, id: 'API' }] }, /terminals\[0\]\.id/],
    [{ terminals: [{ ...terminal, id: 'api' }] }, /terminals\[0\]\.id/],
    [{ terminals: [{ ...terminal, id: 'a'.repeat(33) }] }, /terminals\[0\]\.id/],
    [{ terminals: [{ ...terminal, name: ' 端末H1' }] }, /terminals\[0\]\.name/],
    [{ terminals: [{ ...terminal, mode: 'h' }] }, /terminals\[0\]\.mode/],
    [{ terminals: [{ ...terminal, venueId: 'missing' }] }, /terminals\[0\]\.venueId/],
    [{ terminals: [terminal, terminal] }, /terminals\[1\]\.id/],
    [{ terminals: [terminal, { ...terminal, id: 'h2' }] }, /terminals\[1\]\.name/],
  ];
  for (const [value, expected] of cases)
    assert.throws(() => validateTerminalConfig(value, venueRegistry), expected);
  assert.equal(
    validateTerminalConfig(
      { terminals: [terminal, { ...terminal, id: 'h2', name: '端末H2' }] },
      venueRegistry,
    ).length,
    2,
  );
});

test('ローカル差分は削除表現と不正値を拒否する', () => {
  assert.throws(
    () => validateLocalTerminalConfig({ terminals: [{ id: 'h1', delete: true }] }),
    /delete/,
  );
  assert.throws(
    () => validateLocalTerminalConfig({ terminals: [{ id: 'h1', name: null }] }),
    /name/,
  );
  assert.throws(
    () => validateLocalTerminalConfig({ terminals: [{ id: 'h1' }, { id: 'h1' }] }),
    /重複/,
  );
  withFiles(
    base,
    'terminals:\n  - id: h2\n    name: 端末H1\n    mode: H\n    venueId: east\n',
    (baseUrl, localUrl) => {
      assert.throws(
        () => loadTerminalConfig({ baseUrl, localUrl, environment: 'development', venueRegistry }),
        /terminals\.local\.yaml: terminals\[1\]\.name/,
      );
    },
  );
});

test('読込不能と YAML 構文誤りは絶対パスや設定全文を出さない', () => {
  withFiles('terminals:\n  - id: [\n', undefined, (baseUrl, localUrl) => {
    assert.throws(
      () => loadTerminalConfig({ baseUrl, localUrl, environment: 'production', venueRegistry }),
      /terminals\.yaml のYAML解析に失敗しました: \d+行\d+列/,
    );
  });
  withFiles(base, undefined, (baseUrl, localUrl) => {
    assert.throws(
      () =>
        loadTerminalConfig({
          baseUrl: new URL('missing.yaml', baseUrl),
          localUrl,
          environment: 'production',
          venueRegistry,
        }),
      /missing\.yaml の読み込みに失敗しました/,
    );
  });
});

test('端末設定 API は起動時レジストリの値を非キャッシュで返す', async () => {
  const { createApp } = await import('../src/app.js');
  const loaded = loadTerminalConfig({ venueRegistry, environment: 'production' });
  const app = createApp({
    venueRegistry,
    terminalRegistry: loaded.registry,
    terminalConfig: loaded.response,
  });
  const server = await new Promise<import('node:http').Server>((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  try {
    const address = server.address();
    assert.ok(address !== null && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/config/terminals`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), loaded.response);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
