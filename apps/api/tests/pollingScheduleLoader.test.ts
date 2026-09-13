import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { describe } from 'node:test';
import { pathToFileURL } from 'node:url';
import { loadPollingScheduleConfig } from '../src/config/pollingScheduleLoader.js';
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

  test('既定の config/polling.yaml を正しく読み込めること', () => {
    const config = loadPollingScheduleConfig();
    assert.equal(config.timezone, 'Asia/Tokyo');
    assert.equal(config.amedasPointRecheckSeconds, 600);
    assert.equal(config.freshness.xml.staleAfterSeconds, 300);
    assert.equal(config.freshness.imageCatalog.staleAfterSeconds, 300);
    assert.deepEqual(config.fetchHealth, validFetchHealth);
    assert.equal(config.periods.length, 4);
  });

  test('cwd をどこに変更しても既定URLがリポジトリルートの config/polling.yaml を解決すること (受け入れ条件 15)', () => {
    const origCwd = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wx-cwd-test-'));
    try {
      process.chdir(tempDir);
      const configFromTemp = loadPollingScheduleConfig();
      assert.equal(configFromTemp.timezone, 'Asia/Tokyo');
      assert.equal(configFromTemp.amedasPointRecheckSeconds, 600);
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
      amedasPointRecheckSeconds: 600,
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
      amedasPointRecheckSeconds: 600,
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
