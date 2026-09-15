import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LAYER_PRESENTATIONS } from '../src/map/fixtures';
import {
  KIKIKURU_DATA_COLORS,
  KIKIKURU_COLOR_TOKENS,
  applyDataColors,
} from '../src/theme/dataColors';
import { applyMd3Theme, DEFAULT_THEME_SEED } from '../src/theme';

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

test('kikikuruColors: データ色トークンが公式配色と一致し、DOM へ正しく書き出されること (§7.4.2, §11.5.1)', () => {
  assert.equal(KIKIKURU_DATA_COLORS.imminent, '#0C000C');
  assert.equal(KIKIKURU_DATA_COLORS.danger, '#AA00AA');
  assert.equal(KIKIKURU_DATA_COLORS.warning, '#FF2800');
  assert.equal(KIKIKURU_DATA_COLORS.caution, '#F2E700');
  assert.equal(KIKIKURU_DATA_COLORS.none, '#FFFFFF');

  assert.equal(KIKIKURU_COLOR_TOKENS['--wx-data-kikikuru-imminent'], '#0C000C');
  assert.equal(KIKIKURU_COLOR_TOKENS['--wx-data-kikikuru-danger'], '#AA00AA');
  assert.equal(KIKIKURU_COLOR_TOKENS['--wx-data-kikikuru-warning'], '#FF2800');
  assert.equal(KIKIKURU_COLOR_TOKENS['--wx-data-kikikuru-caution'], '#F2E700');
  assert.equal(KIKIKURU_COLOR_TOKENS['--wx-data-kikikuru-none'], '#FFFFFF');

  // mock DOM 要素で書き出しを検証
  const mockElement = {
    style: {
      setProperty(name: string, value: string) {
        (this as Record<string, unknown>)[name] = value;
      },
    },
  } as unknown as HTMLElement;

  applyDataColors(mockElement);
  assert.equal(
    (mockElement.style as Record<string, unknown>)['--wx-data-kikikuru-caution'],
    '#F2E700',
  );

  // applyMd3Theme を通しても書き出されること
  const mockRoot = {
    style: {
      setProperty(name: string, value: string) {
        (this as Record<string, unknown>)[name] = value;
      },
      colorScheme: '',
    },
  } as unknown as HTMLElement;

  applyMd3Theme(DEFAULT_THEME_SEED, true, mockRoot);
  assert.equal(
    (mockRoot.style as Record<string, unknown>)['--wx-data-kikikuru-caution'],
    '#F2E700',
  );
  assert.equal(
    (mockRoot.style as Record<string, unknown>)['--wx-data-kikikuru-imminent'],
    '#0C000C',
  );
});

test('kikikuruColors: HEX リテラルが dataColors.ts (および既存許可ファイル) 以外に存在しないこと (§11.5.1)', () => {
  const allowedHexFiles = new Set([
    'seeds.ts',
    'semanticColors.ts',
    'weatherDataColors.css',
    'dataColors.ts',
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
              // コメント中の HEX 言及も避けるのが望ましいが、コード内の直書きを禁止
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
