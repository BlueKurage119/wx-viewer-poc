import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, describe } from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_CONFIG_URL,
  LOCAL_CONFIG_URL,
  loadPollingScheduleConfig,
  loadPollingScheduleConfigWithSources,
} from '../src/config/pollingScheduleLoader.js';
import { createTestPollingSchedule } from './helpers/pollingSchedule.js';
import {
  resolvePollingPeriod,
  validatePollingScheduleConfig,
} from '../src/config/pollingSchedule.js';

describe('pollingScheduleLoader (受け入れ条件 5, 15)', () => {
  const validFetchHealth = {
    evaluationIntervalSeconds: 30,
    delayedConsecutiveFailures: 2,
    delayedIntervalMultiplier: 3,
    abnormalConsecutiveFailures: 5,
    abnormalElapsedSeconds: 600,
    maxScanAttempts: 50,
  };
  const validStartupRecovery = {
    delayedThresholdSeconds: 60,
    yieldEveryParsedReceptions: 25,
    candidatePageSize: 100,
  };

  test('既定の config/polling.yaml を形式・値域どおりに読み込めること', () => {
    const config = loadPollingScheduleConfig();
    assert.equal(config.timezone, 'Asia/Tokyo');
    assert.ok(['proxy', 'jma-direct'].includes(config.tileDeliveryProfile));
    assert.ok(config.amedasPointRecheckSeconds > 0);
    assert.ok(config.freshness.xml.staleAfterSeconds > 0);
    assert.ok(config.freshness.imageCatalog.staleAfterSeconds > 0);
    assert.ok(config.fetchHealth.evaluationIntervalSeconds > 0);
    assert.ok(config.startupRecovery.delayedThresholdSeconds > 0);
    assert.ok(config.periods.length > 0);
  });

  test('テスト用スケジュールfixtureは運用値の完全一致を維持すること', () => {
    const config = createTestPollingSchedule();
    assert.equal(config.timezone, 'Asia/Tokyo');
    assert.equal(config.tileDeliveryProfile, 'proxy');
    assert.equal(config.amedasPointRecheckSeconds, 600);
    assert.deepEqual(config.freshness, {
      xml: { staleAfterSeconds: 300 },
      imageCatalog: { staleAfterSeconds: 300 },
    });
    assert.deepEqual(config.fetchHealth, validFetchHealth);
    assert.deepEqual(config.startupRecovery, validStartupRecovery);
    assert.deepEqual(config.periods, [
      {
        start: '04:00',
        end: '05:00',
        xmlSeconds: 120,
        imageCatalogSeconds: 120,
        amedasSeconds: 300,
        nowcastEnabled: true,
        kikikuruEnabled: true,
      },
      {
        start: '05:00',
        end: '18:00',
        xmlSeconds: 60,
        imageCatalogSeconds: 60,
        amedasSeconds: 60,
        nowcastEnabled: true,
        kikikuruEnabled: true,
      },
      {
        start: '18:00',
        end: '20:00',
        xmlSeconds: 120,
        imageCatalogSeconds: 120,
        amedasSeconds: 300,
        nowcastEnabled: true,
        kikikuruEnabled: true,
      },
      {
        start: '20:00',
        end: '04:00',
        xmlSeconds: null,
        imageCatalogSeconds: null,
        amedasSeconds: null,
        nowcastEnabled: false,
        kikikuruEnabled: false,
      },
    ]);
  });

  test('起動時復旧設定は正の安全整数と上限を厳密に検証すること (Issue #193 AC13)', () => {
    const baseConfig = createTestPollingSchedule();
    assert.deepEqual(
      validatePollingScheduleConfig({
        ...baseConfig,
        startupRecovery: { ...validStartupRecovery, delayedThresholdSeconds: 3 },
      }).startupRecovery,
      {
        delayedThresholdSeconds: 3,
        yieldEveryParsedReceptions: 25,
        candidatePageSize: 100,
      },
    );

    for (const delayedThresholdSeconds of [0, -1, 1.5, '60']) {
      assert.throws(
        () =>
          validatePollingScheduleConfig({
            ...baseConfig,
            startupRecovery: { ...validStartupRecovery, delayedThresholdSeconds },
          }),
        /delayedThresholdSeconds は正の安全整数/,
      );
    }
    for (const [key, value] of [
      ['yieldEveryParsedReceptions', 0],
      ['yieldEveryParsedReceptions', 101],
      ['candidatePageSize', 0],
      ['candidatePageSize', 101],
    ] as const) {
      assert.throws(
        () =>
          validatePollingScheduleConfig({
            ...baseConfig,
            startupRecovery: { ...validStartupRecovery, [key]: value },
          }),
        new RegExp(`${key} は 1〜100 の安全整数`),
      );
    }
    assert.throws(
      () =>
        validatePollingScheduleConfig({
          ...baseConfig,
          startupRecovery: { ...validStartupRecovery, unknown: 1 },
        }),
      /未知の startupRecovery 設定キーです: unknown/,
    );
  });

  test('tileDeliveryProfile は proxy と jma-direct だけを受理すること', () => {
    const base = createTestPollingSchedule();
    assert.equal(
      validatePollingScheduleConfig({ ...base, tileDeliveryProfile: 'jma-direct' })
        .tileDeliveryProfile,
      'jma-direct',
    );
    for (const invalid of [undefined, '', 'PROXY', 'unknown', 1]) {
      const candidate = { ...base, tileDeliveryProfile: invalid };
      if (invalid === undefined) delete candidate.tileDeliveryProfile;
      assert.throws(
        () => validatePollingScheduleConfig(candidate),
        /tileDeliveryProfile は "proxy" または "jma-direct"/,
      );
    }
  });

  test('cwd をどこに変更しても既定URLがリポジトリルートの config/polling.yaml を解決すること (受け入れ条件 15)', () => {
    const origCwd = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wx-cwd-test-'));
    const configBeforeChdir = loadPollingScheduleConfig();
    try {
      process.chdir(tempDir);
      const configFromTemp = loadPollingScheduleConfig();
      assert.deepEqual(configFromTemp, configBeforeChdir);
    } finally {
      process.chdir(origCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('存在しないファイル URL を指定した場合は詳細エラーで失敗すること (フォールバックなし)', () => {
    const nonExistentUrl = pathToFileURL('/non/existent/path/polling.yaml');
    assert.throws(
      () => loadPollingScheduleConfig(nonExistentUrl),
      (err: Error) => {
        return (
          err.message.includes('読み込みに失敗しました') && err.message.includes('non/existent')
        );
      },
    );
  });

  test('YAML 構文エラーや重複キー、複数ドキュメントを拒否すること (受け入れ条件 5)', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wx-yaml-err-'));
    try {
      // 重複キー
      const dupKeyPath = path.join(tempDir, 'dup.yaml');
      fs.writeFileSync(dupKeyPath, 'timezone: Asia/Tokyo\ntimezone: Asia/Tokyo\n', 'utf-8');
      assert.throws(
        () => loadPollingScheduleConfig(pathToFileURL(dupKeyPath)),
        /YAML解析に失敗しました/,
      );

      // 複数ドキュメント
      const multiDocPath = path.join(tempDir, 'multi.yaml');
      fs.writeFileSync(multiDocPath, 'a: 1\n---\nb: 2\n', 'utf-8');
      assert.throws(
        () => loadPollingScheduleConfig(pathToFileURL(multiDocPath)),
        /YAML解析に失敗しました/,
      );

      // 構文不正
      const invalidSyntaxPath = path.join(tempDir, 'syntax.yaml');
      fs.writeFileSync(invalidSyntaxPath, 'periods: [unclosed\n', 'utf-8');
      assert.throws(
        () => loadPollingScheduleConfig(pathToFileURL(invalidSyntaxPath)),
        /YAML解析に失敗しました/,
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('バリデーション: 未知キー、欠落キー、型違い、周期不正、被覆不足を拒否すること (受け入れ条件 5)', () => {
    // 未知キー
    assert.throws(
      () => validatePollingScheduleConfig({ extraKey: 123 }),
      /未知のルート設定キーです/,
    );

    // 旧 intervalsSeconds や mode の存在を拒否
    assert.throws(
      () =>
        validatePollingScheduleConfig({
          timezone: 'Asia/Tokyo',
          amedasPointRecheckSeconds: 600,
          startupRecovery: validStartupRecovery,
          freshness: { xml: { staleAfterSeconds: 300 }, imageCatalog: { staleAfterSeconds: 300 } },
          fetchHealth: validFetchHealth,
          periods: [],
          intervalsSeconds: {},
        }),
      /未知のルート設定キーです: intervalsSeconds/,
    );

    // freshness 不正 (欠落、型不正、非正整数)
    assert.throws(
      () =>
        validatePollingScheduleConfig({
          timezone: 'Asia/Tokyo',
          amedasPointRecheckSeconds: 600,
          startupRecovery: validStartupRecovery,
          freshness: { xml: { staleAfterSeconds: -10 }, imageCatalog: { staleAfterSeconds: 300 } },
          fetchHealth: validFetchHealth,
          periods: [],
        }),
      /staleAfterSeconds は正の有限整数/,
    );

    assert.throws(
      () =>
        validatePollingScheduleConfig({
          timezone: 'Asia/Tokyo',
          amedasPointRecheckSeconds: 600,
          startupRecovery: validStartupRecovery,
          freshness: {
            xml: { staleAfterSeconds: 300, staleAfterSecond: 300 },
            imageCatalog: { staleAfterSeconds: 300 },
          },
          fetchHealth: validFetchHealth,
          periods: [],
        }),
      /staleAfterSeconds だけを指定する必要があります/,
    );

    assert.throws(
      () =>
        validatePollingScheduleConfig({
          timezone: 'Asia/Tokyo',
          amedasPointRecheckSeconds: 600,
          startupRecovery: validStartupRecovery,
          freshness: {
            xml: { staleAfterSeconds: 300 },
            imageCatalog: { staleAfterSeconds: 300 },
            legacyPolicy: { staleAfterSeconds: 300 },
          },
          fetchHealth: validFetchHealth,
          periods: [],
        }),
      /未知の freshness 設定キーです: legacyPolicy/,
    );

    // fetchHealth 欠落・不正
    assert.throws(
      () =>
        validatePollingScheduleConfig({
          timezone: 'Asia/Tokyo',
          amedasPointRecheckSeconds: 600,
          startupRecovery: validStartupRecovery,
          freshness: { xml: { staleAfterSeconds: 300 }, imageCatalog: { staleAfterSeconds: 300 } },
          periods: [],
        }),
      /必須ルート設定キーが不足しています: fetchHealth/,
    );

    assert.throws(
      () =>
        validatePollingScheduleConfig({
          timezone: 'Asia/Tokyo',
          amedasPointRecheckSeconds: 600,
          startupRecovery: validStartupRecovery,
          freshness: { xml: { staleAfterSeconds: 300 }, imageCatalog: { staleAfterSeconds: 300 } },
          fetchHealth: { ...validFetchHealth, extraKey: 1 },
          periods: [],
        }),
      /未知の fetchHealth 設定キーです/,
    );

    assert.throws(
      () =>
        validatePollingScheduleConfig({
          timezone: 'Asia/Tokyo',
          amedasPointRecheckSeconds: 600,
          startupRecovery: validStartupRecovery,
          freshness: { xml: { staleAfterSeconds: 300 }, imageCatalog: { staleAfterSeconds: 300 } },
          fetchHealth: { ...validFetchHealth, delayedConsecutiveFailures: 1 },
          periods: [],
        }),
      /delayedConsecutiveFailures は 2 以上/,
    );

    assert.throws(
      () =>
        validatePollingScheduleConfig({
          timezone: 'Asia/Tokyo',
          amedasPointRecheckSeconds: 600,
          startupRecovery: validStartupRecovery,
          freshness: { xml: { staleAfterSeconds: 300 }, imageCatalog: { staleAfterSeconds: 300 } },
          fetchHealth: { ...validFetchHealth, maxScanAttempts: 3 },
          periods: [],
        }),
      /maxScanAttempts \(3\) は abnormalConsecutiveFailures \(5\) より大きい/,
    );

    // start === end (曖昧な全日指定)
    assert.throws(
      () =>
        validatePollingScheduleConfig({
          timezone: 'Asia/Tokyo',
          amedasPointRecheckSeconds: 600,
          startupRecovery: validStartupRecovery,
          freshness: { xml: { staleAfterSeconds: 300 }, imageCatalog: { staleAfterSeconds: 300 } },
          fetchHealth: validFetchHealth,
          periods: [
            {
              start: '00:00',
              end: '00:00',
              xmlSeconds: 60,
              imageCatalogSeconds: 60,
              amedasSeconds: 60,
              nowcastEnabled: true,
              kikikuruEnabled: true,
            },
          ],
        }),
      /start と end が同一です/,
    );

    // 24時間被覆不足 (一部時間帯が抜けている)
    assert.throws(
      () =>
        validatePollingScheduleConfig({
          timezone: 'Asia/Tokyo',
          amedasPointRecheckSeconds: 600,
          startupRecovery: validStartupRecovery,
          freshness: { xml: { staleAfterSeconds: 300 }, imageCatalog: { staleAfterSeconds: 300 } },
          fetchHealth: validFetchHealth,
          periods: [
            {
              start: '00:00',
              end: '12:00',
              xmlSeconds: 60,
              imageCatalogSeconds: 60,
              amedasSeconds: 60,
              nowcastEnabled: true,
              kikikuruEnabled: true,
            },
            // 12:00〜24:00 が欠落
          ],
        }),
      /時間帯範囲が24時間を完全に網羅していません/,
    );
  });

  test('全区間停止、日中null、夜間数値、区間の順序入替え・分割統合が正常に動作すること (受け入れ条件 5)', () => {
    // 全区間停止
    const allStopped = validatePollingScheduleConfig({
      timezone: 'Asia/Tokyo',
      tileDeliveryProfile: 'proxy',
      amedasPointRecheckSeconds: 600,
      startupRecovery: validStartupRecovery,
      freshness: { xml: { staleAfterSeconds: 300 }, imageCatalog: { staleAfterSeconds: 300 } },
      fetchHealth: validFetchHealth,
      periods: [
        {
          start: '00:00',
          end: '12:00',
          xmlSeconds: null,
          imageCatalogSeconds: null,
          amedasSeconds: null,
          nowcastEnabled: false,
          kikikuruEnabled: false,
        },
        {
          start: '12:00',
          end: '00:00',
          xmlSeconds: null,
          imageCatalogSeconds: null,
          amedasSeconds: null,
          nowcastEnabled: false,
          kikikuruEnabled: false,
        },
      ],
    });
    assert.equal(allStopped.periods[0]?.xmlSeconds, null);

    // 順序入替え
    const reordered = validatePollingScheduleConfig({
      timezone: 'Asia/Tokyo',
      tileDeliveryProfile: 'proxy',
      amedasPointRecheckSeconds: 600,
      startupRecovery: validStartupRecovery,
      freshness: { xml: { staleAfterSeconds: 300 }, imageCatalog: { staleAfterSeconds: 300 } },
      fetchHealth: validFetchHealth,
      periods: [
        {
          start: '12:00',
          end: '00:00',
          xmlSeconds: 120,
          imageCatalogSeconds: 120,
          amedasSeconds: 120,
          nowcastEnabled: true,
          kikikuruEnabled: true,
        },
        {
          start: '00:00',
          end: '12:00',
          xmlSeconds: 60,
          imageCatalogSeconds: 60,
          amedasSeconds: 60,
          nowcastEnabled: true,
          kikikuruEnabled: true,
        },
      ],
    });
    assert.equal(reordered.periods.length, 2);

    // 判定時刻の一致 (JST 06:00 -> 00:00〜12:00 の区間)
    const testDate = new Date('2026-09-12T06:00:00+09:00');
    const p = resolvePollingPeriod(testDate, reordered);
    assert.equal(p.xmlSeconds, 60);
  });
});

const originalRead = fs.readFileSync;
const originalEnvironment = process.env.NODE_ENV;
const shared = originalRead(DEFAULT_CONFIG_URL, 'utf-8');

function withFiles(local: string | null, base = shared): void {
  fs.readFileSync = ((file: Parameters<typeof fs.readFileSync>[0], ...args: unknown[]) => {
    const href = file instanceof URL ? file.href : String(file);
    if (href === DEFAULT_CONFIG_URL.href) return base;
    if (href === LOCAL_CONFIG_URL.href) {
      if (local === null) {
        const error = new Error('ファイルなし') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      return local;
    }
    return originalRead(file, ...(args as [BufferEncoding]));
  }) as typeof fs.readFileSync;
  syncBuiltinESMExports();
}

afterEach(() => {
  fs.readFileSync = originalRead;
  syncBuiltinESMExports();
  if (originalEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalEnvironment;
});

test('不在、空の上書き、部分上書きと既存戻り値', () => {
  delete process.env.NODE_ENV;
  withFiles(null);
  const baseline = loadPollingScheduleConfigWithSources();
  assert.equal(baseline.localOverride, 'absent');
  assert.deepEqual(baseline.sources, [DEFAULT_CONFIG_URL]);
  assert.deepEqual(loadPollingScheduleConfig(), baseline.config);

  withFiles('{}');
  const empty = loadPollingScheduleConfigWithSources();
  assert.equal(empty.localOverride, 'applied');
  assert.deepEqual(empty.config, baseline.config);

  withFiles('tileDeliveryProfile: jma-direct\nfreshness:\n  xml:\n    staleAfterSeconds: 600\n');
  const changed = loadPollingScheduleConfigWithSources();
  assert.deepEqual(changed.sources, [DEFAULT_CONFIG_URL, LOCAL_CONFIG_URL]);
  assert.deepEqual(changed.config, {
    ...baseline.config,
    tileDeliveryProfile: 'jma-direct',
    freshness: {
      ...baseline.config.freshness,
      xml: { staleAfterSeconds: 600 },
    },
  });
});

test('配列は全置換し null と false を保持する', () => {
  delete process.env.NODE_ENV;
  withFiles(
    'periods:\n  - start: "00:00"\n    end: "12:00"\n    xmlSeconds: null\n    imageCatalogSeconds: 30\n    amedasSeconds: 30\n    nowcastEnabled: false\n    kikikuruEnabled: false\n  - start: "12:00"\n    end: "00:00"\n    xmlSeconds: 60\n    imageCatalogSeconds: 60\n    amedasSeconds: 60\n    nowcastEnabled: true\n    kikikuruEnabled: true\n',
  );
  const periods = loadPollingScheduleConfig().periods;
  assert.equal(periods.length, 2);
  assert.equal(periods[0]?.xmlSeconds, null);
  assert.equal(periods[0]?.nowcastEnabled, false);
});

test('本番ではローカルへアクセスしない。同じURLと別URLを区別する', () => {
  process.env.NODE_ENV = 'production';
  withFiles('invalid: [');
  assert.equal(loadPollingScheduleConfigWithSources().localOverride, 'disabled-production');
  delete process.env.NODE_ENV;
  assert.throws(() => loadPollingScheduleConfigWithSources(), /YAML解析に失敗/);
  withFiles('{}');
  assert.equal(
    loadPollingScheduleConfigWithSources(new URL(DEFAULT_CONFIG_URL.href)).localOverride,
    'applied',
  );
  const fixture = new URL('./fixtures/polling/schedule.yaml', import.meta.url);
  const explicit = loadPollingScheduleConfigWithSources(fixture);
  assert.equal(explicit.localOverride, 'not-applicable');
  assert.deepEqual(explicit.sources, [fixture]);
});

test('不正なローカル文書と未知キーを拒否する', () => {
  delete process.env.NODE_ENV;
  for (const local of [
    '',
    'null',
    '[]',
    '42',
    'foo: [',
    'foo: 1\nfoo: 2',
    'a: 1\n---\nb: 2',
    'unknown: 1',
    'freshness:\n  xml:\n    staleAfterSeconds: -1',
    'freshness:\n  imageCatalog:\n    unknown: 1',
    'periods: []',
  ]) {
    withFiles(local);
    assert.throws(
      () => loadPollingScheduleConfigWithSources(),
      (error: Error) => {
        assert.match(error.message, /polling.local.yaml/);
        return true;
      },
    );
  }
});

test('循環参照と特殊キーを拒否し、オブジェクトのプロトタイプを汚染しない', () => {
  delete process.env.NODE_ENV;
  withFiles('freshness: &cycle\n  xml: *cycle\n');
  assert.throws(() => loadPollingScheduleConfigWithSources(), /循環参照/);
  withFiles('"__proto__": hacked\n');
  assert.throws(() => loadPollingScheduleConfigWithSources(), /__proto__/);
  assert.equal(({} as Record<string, unknown>).hacked, undefined);
});

test('ローカル読込権限エラーと共有ファイルの不正を救済しない', () => {
  delete process.env.NODE_ENV;
  fs.readFileSync = ((file: Parameters<typeof fs.readFileSync>[0], ...args: unknown[]) => {
    if (file instanceof URL && file.href === LOCAL_CONFIG_URL.href) {
      const error = new Error('権限なし') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      throw error;
    }
    return originalRead(file, ...(args as [BufferEncoding]));
  }) as typeof fs.readFileSync;
  syncBuiltinESMExports();
  assert.throws(
    () => loadPollingScheduleConfigWithSources(),
    /polling.local.yaml.*EACCES|polling.local.yaml.*権限なし/,
  );

  withFiles('{}', 'periods: [');
  assert.throws(() => loadPollingScheduleConfigWithSources(), /polling.yaml.*YAML解析に失敗/);
  fs.readFileSync = ((file: Parameters<typeof fs.readFileSync>[0], ...args: unknown[]) => {
    if (file instanceof URL && file.href === DEFAULT_CONFIG_URL.href) {
      const error = new Error('共有ファイルなし') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    }
    return originalRead(file, ...(args as [BufferEncoding]));
  }) as typeof fs.readFileSync;
  syncBuiltinESMExports();
  assert.throws(() => loadPollingScheduleConfigWithSources(), /polling.yaml.*読み込みに失敗/);
});

test('ローカルの時間帯重複と欠落を検証で拒否する', () => {
  delete process.env.NODE_ENV;
  for (const periods of [
    '  - start: "00:00"\n    end: "12:00"\n  - start: "11:00"\n    end: "00:00"',
    '  - start: "00:00"\n    end: "12:00"',
  ]) {
    const completeFields = periods.replaceAll(
      / {4}end: "([0-9:]+)"/g,
      '    end: "$1"\n    xmlSeconds: 60\n    imageCatalogSeconds: 60\n    amedasSeconds: 60\n    nowcastEnabled: true\n    kikikuruEnabled: true',
    );
    withFiles(`periods:\n${completeFields}\n`);
    assert.throws(() => loadPollingScheduleConfigWithSources(), /時間帯範囲/);
  }
});
