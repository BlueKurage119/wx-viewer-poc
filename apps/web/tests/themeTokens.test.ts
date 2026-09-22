import assert from 'node:assert/strict';
import { test } from 'node:test';
import { argbFromHex, hexFromArgb, themeFromSourceColor } from '@material/material-color-utilities';
import { DEFAULT_THEME_SEED } from '../src/theme/seeds.ts';
import { applyMd3Theme } from '../src/theme/applyTheme.ts';

const PRIMARY_TONE_40_TOKEN = '--md-sys-color-primary-tone-40';

function createRootStub() {
  const properties = new Map<string, string>();
  return {
    style: {
      setProperty(property: string, value: string) {
        properties.set(property, value);
      },
      colorScheme: '',
    },
    properties,
  } as unknown as HTMLElement & { properties: Map<string, string> };
}

function primaryTone40(seed: string): string {
  return hexFromArgb(themeFromSourceColor(argbFromHex(seed)).palettes.primary.tone(40));
}

test('Primary tone 40はテーマシードのパレットからlight/dark共通で書き出される', () => {
  const root = createRootStub();
  const expected = primaryTone40(DEFAULT_THEME_SEED);

  applyMd3Theme(DEFAULT_THEME_SEED, false, root);
  assert.equal(root.properties.get(PRIMARY_TONE_40_TOKEN), expected);

  applyMd3Theme(DEFAULT_THEME_SEED, true, root);
  assert.equal(root.properties.get(PRIMARY_TONE_40_TOKEN), expected);
});

test('Primary tone 40はテーマシードの変更に追従する', () => {
  const root = createRootStub();
  const otherSeed = `#${DEFAULT_THEME_SEED.slice(1).split('').reverse().join('')}`;

  applyMd3Theme(DEFAULT_THEME_SEED, false, root);
  const defaultTone40 = root.properties.get(PRIMARY_TONE_40_TOKEN);

  applyMd3Theme(otherSeed, false, root);
  assert.equal(root.properties.get(PRIMARY_TONE_40_TOKEN), primaryTone40(otherSeed));
  assert.notEqual(root.properties.get(PRIMARY_TONE_40_TOKEN), defaultTone40);
});
