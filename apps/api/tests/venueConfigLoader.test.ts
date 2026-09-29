import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { loadVenueConfig, validateVenueConfig } from '../src/config/venueConfigLoader.js';

function withTemporaryVenueFiles(
  baseContent: string,
  localContent: string | undefined,
  run: (baseUrl: URL, localUrl: URL) => void,
): void {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'venue-config-loader-'));
  const basePath = path.join(directory, 'venues.yaml');
  const localPath = path.join(directory, 'venues.local.yaml');
  try {
    fs.writeFileSync(basePath, baseContent);
    if (localContent !== undefined) fs.writeFileSync(localPath, localContent);
    run(pathToFileURL(basePath), pathToFileURL(localPath));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
function thrownMessage(run: () => void): string {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error, '例外が送出される必要があります');
  return caught.message;
}

test('会場 YAML は旧2会場を順序どおり読み込み、世代とレジストリを生成する', () => {
  const loaded = loadVenueConfig({ environment: 'production' });
  assert.deepEqual(loaded.registry.listVenueIds(), ['east', 'trc']);
  assert.equal(loaded.response.generation.length, 64);
  assert.deepEqual(
    loaded.response.venues.map((venue) => venue.venueName),
    ['東京ビッグサイト', '東京流通センター'],
  );
});

test('会場設定は未知キーと会場内の対象不整合を拒否する', () => {
  assert.throws(
    () => validateVenueConfig({ venues: [{ id: 'east', unknown: true }] }),
    /venues\[0\]\.unknown/,
  );
  assert.throws(
    () =>
      validateVenueConfig({
        venues: [
          {
            id: 'test',
            name: '試験会場',
            experimental: false,
            mapReference: { latitude: 0, longitude: 0 },
            warning: { municipalCode: '1310800', displayName: '江東区', prefectureCode: '130000' },
            warningTimeseries: { municipalCode: '1310800', displayName: '江東区' },
            broadForecast: { areaCode: '130010', displayName: '東京地方' },
            temperatureForecast: { stationCode: '44132', displayName: '東京' },
            amedas: { stationCode: '44136', displayName: '江戸川臨海', elements: '11112010' },
            bosaiBulletin: { includedAreaCodes: ['1310800'] },
          },
        ],
      }),
    /venues\[0\]\.bosaiBulletin\.includedAreaCodes/,
  );
});

test('共有 YAML の必須キー欠落はローカル差分で補完できない', () => {
  withTemporaryVenueFiles(
    'venues:\n  - id: third\n',
    [
      'venues:',
      '  - id: third',
      '    name: 第三会場',
      '    experimental: true',
      '    mapReference: { latitude: 35, longitude: 139 }',
      "    warning: { municipalCode: '1310800', displayName: 江東区, prefectureCode: '130000' }",
      "    warningTimeseries: { municipalCode: '1310800', displayName: 江東区 }",
      "    broadForecast: { areaCode: '130010', displayName: 東京地方 }",
      "    temperatureForecast: { stationCode: '44132', displayName: 東京 }",
      "    amedas: { stationCode: '44136', displayName: 江戸川臨海, elements: '11112010' }",
      "    bosaiBulletin: { includedAreaCodes: ['1310800', '130010'] }",
      '',
    ].join('\n'),
    (baseUrl, localUrl) => {
      assert.throws(
        () => loadVenueConfig({ baseUrl, localUrl, environment: 'development' }),
        /venues\.yaml: venues\[0\]\.name が必要です/,
      );
    },
  );
});

test('読込・構文エラーは相対設定パスと問題箇所だけを示す', () => {
  withTemporaryVenueFiles('venues:\n  - id: [\n', undefined, (baseUrl, localUrl) => {
    const syntaxError = thrownMessage(() =>
      loadVenueConfig({ baseUrl, localUrl, environment: 'production' }),
    );
    assert.match(syntaxError, /^venues\.yaml のYAML解析に失敗しました: \d+行\d+列$/);
    assert.doesNotMatch(syntaxError, /venue-config-loader-|id:/);
  });

  withTemporaryVenueFiles('', undefined, (baseUrl, localUrl) => {
    const missingUrl = new URL('missing.yaml', baseUrl);
    const readError = thrownMessage(() =>
      loadVenueConfig({ baseUrl: missingUrl, localUrl, environment: 'production' }),
    );
    assert.equal(readError, 'missing.yaml の読み込みに失敗しました');
  });
});
