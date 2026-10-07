import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

test('計測スクリプトは一時2DBで準備・起動・事後照合を完了し軽量fixtureはexit2を返す', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wx-measure-script-test-'));
  try {
    const child = spawnSync(
      process.execPath,
      [
        '--import',
        resolve(import.meta.dirname, '../../../node_modules/tsx/dist/loader.mjs'),
        resolve(import.meta.dirname, '../scripts/measureWarningRecovery.ts'),
        '4',
        '0',
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          TMPDIR: directory,
          WX_VIEWER_DB_PATH: undefined,
          WX_VIEWER_WEATHER_DB_PATH: undefined,
          WX_VIEWER_RETAINED_DB_PATH: undefined,
        },
        encoding: 'utf8',
        timeout: 30000,
      },
    );
    assert.equal(child.error, undefined);
    assert.equal(child.status, 2, child.stderr);
    const offset = child.stdout.indexOf('{\n  "executedAt"');
    assert.ok(offset >= 0, child.stdout);
    const report = JSON.parse(child.stdout.slice(offset)) as {
      rowCount: number;
      baselineParsedReceptionCount: number;
      recoveryStateMatchesBaseline: boolean;
      sampleCount: number;
      workerDecision: string;
      recoveryResults: { venueId: string }[];
    };
    assert.equal(report.rowCount, 4);
    assert.equal(report.baselineParsedReceptionCount, 8);
    assert.equal(report.recoveryStateMatchesBaseline, true);
    assert.ok(report.sampleCount < 20);
    assert.equal(report.workerDecision, '後続Issueで要検討');
    assert.deepEqual(report.recoveryResults.map((item) => item.venueId).sort(), ['east', 'trc']);
    // tsx自身の一時cacheとは区別し、計測DB/lease/cacheのdirectory消失を検証する。
    assert.deepEqual(
      readdirSync(directory).filter((name) => name.startsWith('wx-recovery-benchmark-')),
      [],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
