import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [series, firstText, lastText] = process.argv.slice(2);
const first = Number(firstText);
const last = Number(lastText);
const fixedItems = Number(process.env.BENCH_FIXED_ITEMS ?? 11000);
const baselineCommit = '3e95635bf46fb38a559d6ca9d63a36ce414c2ac2';
if (!series || !Number.isInteger(first) || !Number.isInteger(last) || first > last)
  throw new Error('系列と反復番号を指定');
if (!Number.isInteger(fixedItems) || fixedItems < 1) throw new Error('解析回数が不正');
if (!process.env.BENCH_BASELINE_ROOT || !process.env.BENCH_OUTPUT_DIR)
  throw new Error('BENCH_BASELINE_ROOT、BENCH_OUTPUT_DIR を指定');
const baselineRoot = resolve(process.env.BENCH_BASELINE_ROOT);
const outputDir = resolve(process.env.BENCH_OUTPUT_DIR);
const currentRoot = resolve('.');
function verifiedCommit(root, expected) {
  const git = (...args) => {
    const result = spawnSync('git', ['-c', 'core.fsmonitor=false', '-C', root, ...args], {
      encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(`Git 検証失敗 (${root}): ${result.stderr.trim()}`);
    return result.stdout.trim();
  };
  if (resolve(git('rev-parse', '--show-toplevel')) !== root)
    throw new Error(`計測ルートが Git ルートではありません: ${root}`);
  const commit = git('rev-parse', 'HEAD');
  if (expected && commit !== expected)
    throw new Error(`旧版のコミットが不一致: 期待 ${expected}、実際 ${commit}`);
  if (git('status', '--porcelain', '--untracked-files=normal'))
    throw new Error(`計測ルートに未コミットの変更があります: ${root}`);
  return commit;
}
const currentCommit = verifiedCommit(currentRoot);
const actualBaselineCommit = verifiedCommit(baselineRoot, baselineCommit);
mkdirSync(outputDir, { recursive: true });
for (let repeat = first; repeat <= last; repeat++) {
  const tileTime = new Date().toISOString();
  const root = currentRoot;
  const base = join(outputDir, `issue260-compare-${series}`);
  const run = (mode) => {
    const output = `${base}-${mode}-r${repeat}.json`;
    const environment = {
      ...process.env,
      NODE_ENV: 'production',
      BENCH_ROOT: mode === 'old' ? baselineRoot : root,
      BENCH_MODE: mode,
      BENCH_COMMIT: mode === 'old' ? actualBaselineCommit : currentCommit,
      BENCH_SERIES: series,
      BENCH_TILE_TIME: tileTime,
      BENCH_OUTPUT: output,
      BENCH_FIXED_ITEMS: String(fixedItems),
    };
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', fileURLToPath(new URL('./issue260Compare.mts', import.meta.url))],
      { env: environment, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10_000_000 },
    );
    const record = JSON.parse(readFileSync(output, 'utf8'));
    const measurement = record.measurement;
    const summary = {
      mode,
      repeat,
      stage: record.stage,
      exit: result.status,
      preflight: record.preflight,
      items: measurement?.loadItems,
      loadMs: measurement?.loadEndedMs,
      cpuMs: measurement?.processCpuMs,
      rssPeakDuring: measurement?.rssPeakDuring,
      p50: measurement?.p50Ms,
      p95: measurement?.p95Ms,
      p99: measurement?.p99Ms,
      max: measurement?.maxMs,
      failures: measurement?.failures,
      output,
      error: record.error,
    };
    process.stdout.write(JSON.stringify(summary) + '\n');
    if (result.status !== 0 || record.stage !== 'completed') {
      process.stderr.write(result.stderr.toString().slice(-3000));
      process.exit(1);
    }
    return record;
  };
  run('new');
  run('old');
}
