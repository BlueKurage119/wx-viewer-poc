import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import Database from 'better-sqlite3';

const root = path.resolve(import.meta.dirname, '../../..');
interface Event {
  kind: string;
  pid: number;
  at: number;
  code?: number;
  port?: number;
  threadId?: number;
  isMainThread?: boolean;
  role?: string;
  readonly?: boolean;
}
function assertDatabaseOwners(events: Event[]) {
  const main = events.filter((event) => event.kind === 'db-close' && event.isMainThread);
  const workers = events.filter((event) => event.kind === 'db-close' && !event.isMainThread);
  assert.deepEqual(main.map((event) => [event.role, event.readonly, event.threadId]).sort(), [
    ['retained', false, 0],
    ['weather', true, 0],
  ]);
  assert.equal(workers.length, 1);
  assert.deepEqual([workers[0]!.role, workers[0]!.readonly], ['weather', false]);
  assert.ok(workers[0]!.threadId! > 0);
}
function fixture() {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'wx-dev-lifecycle-'));
  for (const name of [
    'package.json',
    'tsconfig.base.json',
    'scripts',
    'config',
    'apps/api/src',
    'apps/api/migrations',
    'apps/api/package.json',
    'apps/web',
    'packages/shared',
  ]) {
    fs.cpSync(path.join(root, name), path.join(directory, name), {
      recursive: true,
      filter: (p) =>
        !p.split(path.sep).some((part) => ['node_modules', 'dist', 'data'].includes(part)),
    });
  }
  fs.mkdirSync(path.join(directory, 'packages/shared/dist'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'node_modules'));
  for (const entry of fs.readdirSync(path.join(root, 'node_modules'))) {
    if (!entry.startsWith('.vite'))
      fs.symlinkSync(
        path.join(root, 'node_modules', entry),
        path.join(directory, 'node_modules', entry),
      );
  }
  const trace = path.join(directory, 'trace.jsonl');
  fs.writeFileSync(trace, '');
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: '0',
    DISABLE_POLLING: 'true',
    WX_VIEWER_DB_PATH: undefined,
    WX_VIEWER_WEATHER_DB_PATH: path.join(directory, 'weather.sqlite3'),
    WX_VIEWER_RETAINED_DB_PATH: path.join(directory, 'retained.sqlite3'),
    WX_TEST_DEV_TRACE: trace,
    NODE_OPTIONS: `--import=${new URL('./helpers/devLifecyclePreload.mjs', import.meta.url).href}`,
  };
  const events = () =>
    fs
      .readFileSync(trace, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Event);
  return { directory, trace, env, events };
}
async function webPortArgs() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return ['--port', String(port), '--strictPort'];
}
function waitForExit(child: ReturnType<typeof spawn>) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}
async function cleanupFixture(
  f: ReturnType<typeof fixture>,
  child: ReturnType<typeof spawn>,
  exited: Promise<unknown>,
) {
  try {
    process.kill(-child.pid!, 'SIGTERM');
  } catch {
    /* 所有groupは終了済み */
  }
  const owned = f
    .events()
    .filter((e) => ['api-process', 'runner-process', 'web-process'].includes(e.kind))
    .map((e) => e.pid);
  for (const pid of owned) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* 終了済みfixture */
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      exited,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('所有fixtureの終了待ちtimeout')), 5000);
      }),
    ]);
    await until(
      () =>
        owned.every((pid) => {
          try {
            process.kill(pid, 0);
            return false;
          } catch {
            return true;
          }
        }),
      () => '所有fixture APIの終了確認',
    );
  } catch (error) {
    // 破壊試験の後片付けだけに限定する。production runnerは強制killしない。
    for (const pid of owned) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* 終了済み */
      }
    }
    try {
      process.kill(-child.pid!, 'SIGKILL');
    } catch {
      /* 終了済み */
    }
    await exited;
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
}
async function until(predicate: () => boolean, output: () => string) {
  const deadline = Date.now() + 15000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`fixture timeout: ${output()}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
for (const command of ['dev', 'dev:host', 'api', 'dev-sighup']) {
  test(`実npm ${command}はCtrl+C一回で両lockを除き同pairで再起動できる`, async () => {
    const f = fixture();
    let output = '';
    const args =
      command === 'api'
        ? ['run', 'dev', '-w', 'apps/api']
        : ['run', command === 'dev-sighup' ? 'dev' : command, '--', ...(await webPortArgs())];
    let child = spawn('npm', args, { cwd: f.directory, env: f.env, detached: true });
    let exited = waitForExit(child);
    child.stdout.on('data', (data) => {
      output += String(data);
    });
    child.stderr.on('data', (data) => {
      output += String(data);
    });
    try {
      await until(
        () =>
          f.events().some((e) => e.kind === 'ready') &&
          (command === 'api' || f.events().some((e) => e.kind === 'web-ready')),
        () => output,
      );
      if (command !== 'api') {
        const webReady = f.events().find((e) => e.kind === 'web-ready')!;
        assert.equal(webReady.port, Number(args[args.indexOf('--port') + 1]));
        assert.ok(webReady.port! > 0 && ![5173, 5174].includes(webReady.port!));
      }
      const requestedSignal = command === 'dev-sighup' ? 'SIGHUP' : 'SIGINT';
      process.kill(-child.pid!, requestedSignal);
      const npmExit = await exited;
      assert.ok(
        (npmExit.code === 0 && npmExit.signal === null) ||
          (npmExit.code === null && npmExit.signal === requestedSignal),
        JSON.stringify(npmExit) + stripVTControlCharacters(output),
      );
      // npm shell親のSIGINT終了と製品runnerの終了を分け、全close後の正常exitを確認する。
      const runner = f.events().find((e) => e.kind === 'runner-process')!;
      await until(
        () => f.events().some((e) => e.kind === 'runner-exit' && e.pid === runner.pid),
        () => stripVTControlCharacters(output),
      );
      const runnerExit = f.events().find((e) => e.kind === 'runner-exit' && e.pid === runner.pid)!;
      assert.equal(runnerExit.code, 0);
      assert.doesNotMatch(
        stripVTControlCharacters(output),
        /Cannot find base config|failed to resolve "extends"/,
      );
      const closedEvents = f.events().filter((e) => e.kind === 'db-close');
      assertDatabaseOwners(closedEvents);
      assert.ok(closedEvents.every((e) => e.at <= runnerExit.at));
      for (const name of ['weather', 'retained'])
        assert.equal(fs.existsSync(path.join(f.directory, `${name}.sqlite3.writer-lock`)), false);
      const first = f.events().find((e) => e.kind === 'api-process')!;
      const firstEvents = f.events().filter((e) => e.pid === first.pid);
      assert.deepEqual(
        firstEvents
          .filter((e) => e.kind === 'signal')
          .map((e) => (e as Event & { signal: string }).signal),
        ['SIGTERM'],
      );
      assertDatabaseOwners(firstEvents);
      assert.equal(firstEvents.filter((e) => e.kind === 'http-stop').length, 1);
      const retained = new Database(path.join(f.directory, 'retained.sqlite3'), { readonly: true });
      assert.equal(
        retained
          .prepare("SELECT COUNT(*) FROM operation_history WHERE request_id LIKE 'shutdown-%'")
          .pluck()
          .get(),
        1,
      );
      assert.equal(
        retained
          .prepare(
            "SELECT COUNT(*) FROM notification_output_history WHERE message_definition_id='system-service-stopped'",
          )
          .pluck()
          .get(),
        1,
      );
      retained.close();
      child = spawn('npm', args, { cwd: f.directory, env: f.env, detached: true });
      exited = waitForExit(child);
      child.stdout.on('data', (data) => {
        output += String(data);
      });
      child.stderr.on('data', (data) => {
        output += String(data);
      });
      await until(
        () => f.events().filter((e) => e.kind === 'ready').length === 2,
        () => output,
      );
      const apiPid = f
        .events()
        .filter((e) => e.kind === 'api-process')
        .at(-1)!.pid;
      // 実APIに短時間の重複signalを注入する。所有fixtureのみを対象にする。
      process.kill(apiPid, 'SIGINT');
      process.kill(apiPid, 'SIGINT');
      process.kill(apiPid, 'SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 25));
      process.kill(apiPid, 'SIGINT');
      await exited;
      for (const name of ['weather', 'retained'])
        assert.equal(fs.existsSync(path.join(f.directory, `${name}.sqlite3.writer-lock`)), false);
      assertDatabaseOwners(f.events().filter((e) => e.pid === apiPid));
    } finally {
      await cleanupFixture(f, child, exited);
    }
  });
}

test('watchは旧API終了後に再起動し複数変更で並行起動しない', async () => {
  const f = fixture();
  let output = '';
  const child = spawn('npm', ['run', 'dev', '-w', 'apps/api'], {
    cwd: f.directory,
    env: f.env,
    detached: true,
  });
  const exited = waitForExit(child);
  child.stdout.on('data', (d) => {
    output += String(d);
  });
  child.stderr.on('data', (d) => {
    output += String(d);
  });
  try {
    await until(
      () => f.events().some((e) => e.kind === 'ready'),
      () => output,
    );
    for (let i = 0; i < 3; i += 1)
      fs.appendFileSync(
        path.join(f.directory, 'apps/api/src/server.ts'),
        '\n// fixture watch変更。\n',
      );
    await until(
      () => f.events().filter((e) => e.kind === 'ready').length === 2,
      () => output,
    );
    for (const [file, comment] of [
      ['packages/shared/src/index.ts', '\n// fixture shared変更。\n'],
      ['config/polling.yaml', '\n# fixture config変更。\n'],
    ]) {
      const count = f.events().filter((e) => e.kind === 'ready').length;
      fs.appendFileSync(path.join(f.directory, file!), comment!);
      await until(
        () => f.events().filter((e) => e.kind === 'ready').length === count + 1,
        () => output,
      );
    }
    const all = f.events().filter((e) => e.kind === 'api-process');
    for (let i = 1; i < all.length; i += 1) {
      assert.ok(
        f.events().find((e) => e.pid === all[i - 1]!.pid && e.kind === 'exit')!.at <= all[i]!.at,
      );
    }
    const [first, second] = all;
    const oldExit = f.events().find((e) => e.pid === first!.pid && e.kind === 'exit')!;
    assert.ok(oldExit.at <= second!.at);
    assertDatabaseOwners(f.events().filter((e) => e.pid === first!.pid));
    process.kill(-child.pid!, 'SIGINT');
    await exited;
    assert.equal(f.events().filter((e) => e.kind === 'api-process').length, 4);
  } finally {
    await cleanupFixture(f, child, exited);
  }
});

for (const scenario of ['warning', 'failed-watch', 'early-signal', 'unexpected-api']) {
  test(`dev停止の${scenario}は終了完了を待ちDB/leaseを保全する`, async () => {
    const f = fixture();
    let output = '';
    const early = scenario === 'early-signal';
    const child = early
      ? spawn(process.execPath, ['--import', import.meta.resolve('tsx'), 'src/server.ts'], {
          cwd: path.join(f.directory, 'apps/api'),
          env: { ...f.env, WX_TEST_EARLY_SIGNAL: '1' },
          detached: true,
        })
      : spawn(
          'npm',
          scenario === 'unexpected-api'
            ? ['run', 'dev', '--', ...(await webPortArgs())]
            : ['run', 'dev', '-w', 'apps/api'],
          {
            cwd: f.directory,
            env: {
              ...f.env,
              ...(scenario === 'warning'
                ? { WX_TEST_SHORT_WARNING: '1' }
                : {
                    WX_TEST_FAIL_API_EXIT: '1',
                    ...(scenario === 'unexpected-api' ? { WX_TEST_UNEXPECTED_API: '1' } : {}),
                  }),
            },
            detached: true,
          },
        );
    const exited = new Promise<number | null>((resolve) => child.once('close', resolve));
    child.stdout.on('data', (d) => {
      output += String(d);
    });
    child.stderr.on('data', (d) => {
      output += String(d);
    });
    try {
      if (!early && scenario !== 'unexpected-api') {
        await until(
          () => f.events().some((e) => e.kind === 'ready'),
          () => output,
        );
        if (scenario === 'failed-watch')
          fs.appendFileSync(
            path.join(f.directory, 'apps/api/src/server.ts'),
            '\n// fixture failure。\n',
          );
        else process.kill(-child.pid!, 'SIGINT');
      }
      const code = await exited;
      if (early) assert.equal(code, 0, output);
      else if (scenario === 'failed-watch' || scenario === 'unexpected-api')
        assert.equal(code, 7, output);
      else assert.notEqual(code, 0, output);
      if (scenario === 'warning') assert.match(output, /強制終了せず終了を待ち/);
      if (scenario === 'failed-watch') assert.match(output, /停止が失敗しました \(7\)/);
      assert.equal(f.events().filter((e) => e.kind === 'api-process').length, 1);
      if (scenario === 'unexpected-api') {
        assert.deepEqual(
          f.events().filter((event) => event.kind === 'db-close'),
          [],
        );
      } else if (early) {
        assert.deepEqual(
          f
            .events()
            .filter((event) => event.kind === 'db-close')
            .map((event) => [event.role, event.readonly, event.threadId]),
          [['retained', false, 0]],
        );
        assert.deepEqual(
          f.events().filter((event) => event.kind === 'worker-process'),
          [],
        );
      } else {
        assertDatabaseOwners(f.events());
      }
      for (const name of ['weather', 'retained'])
        assert.equal(
          fs.existsSync(path.join(f.directory, `${name}.sqlite3.writer-lock`)),
          scenario === 'unexpected-api',
        );
    } finally {
      await cleanupFixture(f, child, exited);
    }
  });
}
