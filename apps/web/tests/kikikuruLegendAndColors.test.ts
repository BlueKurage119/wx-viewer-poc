import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LAYER_PRESENTATIONS } from '../src/map/fixtures';

test('kikikuruLegend: 凡例の階級ラベルが公式確定値と完全一致すること (§7.4.1, §11.5)', () => {
  const heavyrain = LAYER_PRESENTATIONS['kikikuru-heavyrain'];
  const inund = LAYER_PRESENTATIONS['kikikuru-inund'];
  const land = LAYER_PRESENTATIONS['kikikuru-land'];

  // 大雨キキクル: 警戒レベル相当なし
  const heavyrainLabels = heavyrain.legendItems.map((i) => i.label);
  assert.deepEqual(heavyrainLabels, ['災害切迫', '危険', '警戒', '注意', '今後の情報等に留意']);

  // 浸水キキクル: 災害切迫のみ警戒レベル5相当、注意・警戒・危険には付記なし
  const inundLabels = inund.legendItems.map((i) => i.label);
  assert.deepEqual(inundLabels, [
    '災害切迫 (警戒レベル5相当)',
    '危険',
    '警戒',
    '注意',
    '今後の情報等に留意',
  ]);

  // 土砂キキクル: 注意・警戒・危険・災害切迫すべてに警戒レベル相当が付記
  const landLabels = land.legendItems.map((i) => i.label);
  assert.deepEqual(landLabels, [
    '災害切迫 (警戒レベル5相当)',
    '危険 (警戒レベル4相当)',
    '警戒 (警戒レベル3相当)',
    '注意 (警戒レベル2相当)',
    '今後の情報等に留意',
  ]);

  // 旧表記「非常に危険」「極めて危険」が一切含まれないこと
  for (const layer of [heavyrain, inund, land]) {
    for (const item of layer.legendItems) {
      assert.ok(
        !item.label.includes('非常に危険'),
        `旧表記「非常に危険」が含まれています: ${item.label}`,
      );
      assert.ok(
        !item.label.includes('極めて危険'),
        `旧表記「極めて危険」が含まれています: ${item.label}`,
      );
    }
  }
});

test('kikikuruLegend: 凡例の swatchToken が var(--wx-data-kikikuru-*) を参照し、--wx-alert-level-* を流用していないこと (§7.4.2, §11.5.1)', () => {
  const expectedTokens = [
    'var(--wx-data-kikikuru-imminent)',
    'var(--wx-data-kikikuru-danger)',
    'var(--wx-data-kikikuru-warning)',
    'var(--wx-data-kikikuru-caution)',
    'var(--wx-data-kikikuru-none)',
  ];

  for (const layerId of ['kikikuru-heavyrain', 'kikikuru-inund', 'kikikuru-land'] as const) {
    const layer = LAYER_PRESENTATIONS[layerId];
    const swatches = layer.legendItems.map((i) => i.swatchToken);
    assert.deepEqual(swatches, expectedTokens);

    for (const token of swatches) {
      assert.ok(
        !token.includes('--wx-alert-level'),
        `--wx-alert-level が流用されています: ${token}`,
      );
    }
  }
});

test('kikikuruColors: 公式配色プリミティブおよびキキクルデータ色トークンが CSS として定義されていること (§7.4.2, §7.4.3, §11.5.1, §11.5.2)', () => {
  const baseDir = process.cwd().endsWith('apps/web')
    ? process.cwd()
    : join(process.cwd(), 'apps/web');

  // 1. officialJmaColors.css の検証
  const officialCssPath = join(baseDir, 'src/theme/officialJmaColors.css');
  const officialCss = readFileSync(officialCssPath, 'utf-8');
  assert.ok(officialCss.includes('HPColorGuide_202007.pdf'), '出典 PDF が記載されていること');
  assert.ok(officialCss.includes('2026-09-15'), '取得日 2026-09-15 が記載されていること');
  assert.ok(officialCss.includes('--wx-jma-hue-dark-purple: #0c000c;'));
  assert.ok(officialCss.includes('--wx-jma-hue-purple: #aa00aa;'));
  assert.ok(officialCss.includes('--wx-jma-hue-red: #ff2800;'));
  assert.ok(officialCss.includes('--wx-jma-hue-yellow: #f2e700;'));
  assert.ok(officialCss.includes('--wx-jma-hue-white: #ffffff;'));

  // 2. kikikuruDataColors.css の検証 (HEX 直書きがなく var() 参照であること)
  const kikikuruCssPath = join(baseDir, 'src/theme/kikikuruDataColors.css');
  const kikikuruCss = readFileSync(kikikuruCssPath, 'utf-8');
  assert.ok(kikikuruCss.includes('--wx-data-kikikuru-imminent: var(--wx-jma-hue-dark-purple);'));
  assert.ok(kikikuruCss.includes('--wx-data-kikikuru-danger: var(--wx-jma-hue-purple);'));
  assert.ok(kikikuruCss.includes('--wx-data-kikikuru-warning: var(--wx-jma-hue-red);'));
  assert.ok(kikikuruCss.includes('--wx-data-kikikuru-caution: var(--wx-jma-hue-yellow);'));
  assert.ok(kikikuruCss.includes('--wx-data-kikikuru-none: var(--wx-jma-hue-white);'));
  assert.ok(
    !/#[0-9A-Fa-f]{6}/.test(kikikuruCss),
    'kikikuruDataColors.css に HEX リテラルが含まれていないこと',
  );

  // 3. weatherDataColors.css の検証 (--wx-data-nowcast-7 が var(--wx-jma-hue-red) であること)
  const nowcastCssPath = join(baseDir, 'src/theme/weatherDataColors.css');
  const nowcastCss = readFileSync(nowcastCssPath, 'utf-8');
  assert.ok(
    nowcastCss.includes('--wx-data-nowcast-7: var(--wx-jma-hue-red);'),
    '--wx-data-nowcast-7 が var(--wx-jma-hue-red) 参照であること',
  );

  // 4. index.css での @import 順序の検証
  const indexCssPath = join(baseDir, 'src/index.css');
  const indexCss = readFileSync(indexCssPath, 'utf-8');
  const officialImportPos = indexCss.indexOf("@import './theme/officialJmaColors.css';");
  const kikikuruImportPos = indexCss.indexOf("@import './theme/kikikuruDataColors.css';");
  assert.ok(officialImportPos !== -1, 'officialJmaColors.css が @import されていること');
  assert.ok(kikikuruImportPos !== -1, 'kikikuruDataColors.css が @import されていること');
  assert.ok(
    officialImportPos < kikikuruImportPos,
    'officialJmaColors.css が先に @import されていること',
  );
});

test('kikikuruColors: HEX リテラルが officialJmaColors.css (および既存許可ファイル) 以外に存在しないこと (§11.5.2)', () => {
  const allowedHexFiles = new Set([
    'seeds.ts',
    'semanticColors.ts',
    'weatherDataColors.css',
    'officialJmaColors.css',
  ]);

  const hexPattern = /#[0-9A-Fa-f]{6}/;
  const baseDir = process.cwd().endsWith('apps/web')
    ? process.cwd()
    : join(process.cwd(), 'apps/web');
  const srcDir = join(baseDir, 'src');

  function scanDir(dir: string): void {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        scanDir(fullPath);
      } else if (
        stat.isFile() &&
        (entry.endsWith('.ts') || entry.endsWith('.tsx') || entry.endsWith('.css'))
      ) {
        if (!allowedHexFiles.has(entry)) {
          const content = readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            if (hexPattern.test(line)) {
              assert.fail(
                `HEX リテラルが許可されていないファイルで検出されました: ${fullPath}:${i + 1} -> ${line}`,
              );
            }
          }
        }
      }
    }
  }

  scanDir(srcDir);
});
