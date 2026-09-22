import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKikikuruTileUrlTemplate } from '../src/map/kikikuru/kikikuruTileUrl';

test('kikikuruTileUrl: 6 つのクエリキーを持つ URL テンプレートを生成すること (§7.1, §11.2)', () => {
  const url = buildKikikuruTileUrlTemplate({
    frame: {
      layer: 'heavyrain',
      baseTime: '2026-09-15T03:00:00.000Z',
      validTime: '2026-09-15T03:00:00.000Z',
      imageId: 'rain_mesh',
      member: 'immed0',
    },
    terminalId: 'hkeagh01',
    controlStatus: 'normal',
    tileDeliveryProfile: 'proxy',
  });

  const [path, queryString] = url.split('?');
  assert.ok(path);
  assert.ok(queryString);

  assert.equal(path, '/api/weather/kikikuru/heavyrain/tiles/{z}/{x}/{y}.png');

  const params = new URLSearchParams(queryString);
  const keys = Array.from(params.keys());
  assert.equal(keys.length, 6);
  assert.equal(params.get('terminalId'), 'hkeagh01');
  assert.equal(params.get('controlStatus'), 'normal');
  assert.equal(params.get('baseTime'), '2026-09-15T03:00:00.000Z');
  assert.equal(params.get('validTime'), '2026-09-15T03:00:00.000Z');
  assert.equal(params.get('imageId'), 'rain_mesh');
  assert.equal(params.get('member'), 'immed0');
});

test('kikikuruTileUrl: 各種別 (inund, land) で正しいパスと imageId が使われること', () => {
  const inundUrl = buildKikikuruTileUrlTemplate({
    frame: {
      layer: 'inund',
      baseTime: '2026-09-15T02:50:00.000Z',
      validTime: '2026-09-15T02:50:00.000Z',
      imageId: 'inund',
      member: 'immed1',
    },
    terminalId: 'htrcph01',
    controlStatus: 'normal',
    tileDeliveryProfile: 'proxy',
  });
  assert.ok(inundUrl.startsWith('/api/weather/kikikuru/inund/tiles/{z}/{x}/{y}.png'));
  assert.ok(inundUrl.includes('imageId=inund'));

  const landUrl = buildKikikuruTileUrlTemplate({
    frame: {
      layer: 'land',
      baseTime: '2026-09-15T02:40:00.000Z',
      validTime: '2026-09-15T02:40:00.000Z',
      imageId: 'land',
      member: 'none',
    },
    terminalId: 'hkeagh01',
    controlStatus: 'normal',
    tileDeliveryProfile: 'proxy',
  });
  assert.ok(landUrl.startsWith('/api/weather/kikikuru/land/tiles/{z}/{x}/{y}.png'));
  assert.ok(landUrl.includes('imageId=land'));
});

test('kikikuruTileUrl: jma-direct は気象庁URLを完全一致で生成し、不正日時を拒否すること', () => {
  const directUrl = buildKikikuruTileUrlTemplate({
    frame: {
      layer: 'heavyrain',
      baseTime: '2024-02-29T03:04:05.000Z',
      validTime: '2024-02-29T03:14:05.000Z',
      imageId: 'rain_mesh',
      member: 'immed0',
    },
    terminalId: 'hkeagh01',
    controlStatus: 'normal',
    tileDeliveryProfile: 'jma-direct',
  });
  assert.equal(
    directUrl,
    'https://www.jma.go.jp/bosai/jmatile/data/risk/20240229030405/immed0/20240229031405/surf/rain_mesh/{z}/{x}/{y}.png',
  );
  assert.equal(
    buildKikikuruTileUrlTemplate({
      frame: {
        layer: 'land',
        baseTime: 'invalid',
        validTime: '2024-02-29T03:14:05.000Z',
        imageId: 'land',
        member: 'none',
      },
      terminalId: 'hkeagh01',
      controlStatus: 'normal',
      tileDeliveryProfile: 'jma-direct',
    }),
    null,
  );
});
