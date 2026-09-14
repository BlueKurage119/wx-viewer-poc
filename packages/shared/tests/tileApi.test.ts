import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TILE_API_ALLOWED_ZOOMS,
  parseTileTimesQuery,
  parseNowcastTileRequest,
  parseKikikuruTileRequest,
} from '../src/tileApi.js';

test('TILE_API_ALLOWED_ZOOMS: 許可 zoom が [10] のみであることを完全一致で確認', () => {
  assert.deepEqual(TILE_API_ALLOWED_ZOOMS, [10]);
});

test('parseTileTimesQuery: 正常系および異常系が既存の parseWeatherApiQuery と同一挙動であることを確認', () => {
  assert.deepEqual(parseTileTimesQuery({ terminalId: 'hkeagh01', controlStatus: 'normal' }), {
    ok: true,
    value: { terminalId: 'hkeagh01', controlStatus: 'normal' },
  });
  assert.deepEqual(parseTileTimesQuery(null), { ok: false, error: 'invalid_request' });
  assert.deepEqual(parseTileTimesQuery({}), { ok: false, error: 'invalid_request' });
  assert.deepEqual(
    parseTileTimesQuery({ terminalId: 'hkeagh01', controlStatus: 'normal', extra: '1' }),
    { ok: false, error: 'invalid_request' },
  );
});

test('parseNowcastTileRequest: 正常系 - 正しい params と query がパースされ frame が組み立てられる', () => {
  const params = { product: 'N1', z: '10', x: '900', y: '400' };
  const query = {
    terminalId: 'hkeagh01',
    controlStatus: 'normal',
    baseTime: '2026-09-14T06:00:00.000Z',
    validTime: '2026-09-14T06:05:00.000Z',
  };

  const res = parseNowcastTileRequest(params, query);
  assert.deepEqual(res, {
    ok: true,
    value: {
      terminalId: 'hkeagh01',
      controlStatus: 'normal',
      coordinate: { zoom: 10, tileX: 900, tileY: 400 },
      frame: {
        product: 'N1',
        baseTime: '2026-09-14T06:00:00.000Z',
        validTime: '2026-09-14T06:05:00.000Z',
        element: 'hrpns',
        member: 'none',
      },
    },
  });

  const resN2 = parseNowcastTileRequest({ ...params, product: 'N2' }, query);
  assert.equal(resN2.ok, true);
  if (resN2.ok) {
    assert.equal(resN2.value.frame.product, 'N2');
  }
});

test('parseNowcastTileRequest: 異常系 - product, z, x, y, query キー数, 日時形式の違反は invalid_request', () => {
  const validParams = { product: 'N1', z: '10', x: '900', y: '400' };
  const validQuery = {
    terminalId: 'hkeagh01',
    controlStatus: 'normal',
    baseTime: '2026-09-14T06:00:00.000Z',
    validTime: '2026-09-14T06:05:00.000Z',
  };

  // product 不正
  assert.deepEqual(parseNowcastTileRequest({ ...validParams, product: 'N3' }, validQuery), {
    ok: false,
    error: 'invalid_request',
  });

  // z 範囲外 (z10以外)
  assert.deepEqual(parseNowcastTileRequest({ ...validParams, z: '9' }, validQuery), {
    ok: false,
    error: 'invalid_request',
  });
  assert.deepEqual(parseNowcastTileRequest({ ...validParams, z: '11' }, validQuery), {
    ok: false,
    error: 'invalid_request',
  });
  assert.deepEqual(parseNowcastTileRequest({ ...validParams, z: '010' }, validQuery), {
    ok: false,
    error: 'invalid_request',
  });

  // x, y 範囲外・小数・負値・先頭ゼロ
  assert.deepEqual(parseNowcastTileRequest({ ...validParams, x: '-1' }, validQuery), {
    ok: false,
    error: 'invalid_request',
  });
  assert.deepEqual(parseNowcastTileRequest({ ...validParams, x: '1024' }, validQuery), {
    ok: false,
    error: 'invalid_request',
  });
  assert.deepEqual(parseNowcastTileRequest({ ...validParams, y: '1024' }, validQuery), {
    ok: false,
    error: 'invalid_request',
  });
  assert.deepEqual(parseNowcastTileRequest({ ...validParams, x: '01' }, validQuery), {
    ok: false,
    error: 'invalid_request',
  });
  assert.deepEqual(parseNowcastTileRequest({ ...validParams, x: '1.5' }, validQuery), {
    ok: false,
    error: 'invalid_request',
  });

  // query キー欠落・未知キー
  assert.deepEqual(parseNowcastTileRequest(validParams, { ...validQuery, extra: '1' }), {
    ok: false,
    error: 'invalid_request',
  });
  // terminalId 欠落
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { terminalId: _, ...withoutTerminal } = validQuery;
  assert.deepEqual(parseNowcastTileRequest(validParams, withoutTerminal), {
    ok: false,
    error: 'invalid_request',
  });

  // 日時形式不正 (ISOミリ秒なし、実在しない日付など)
  assert.deepEqual(
    parseNowcastTileRequest(validParams, {
      ...validQuery,
      baseTime: '2026-09-14T06:00:00Z',
    }),
    { ok: false, error: 'invalid_request' },
  );
  assert.deepEqual(
    parseNowcastTileRequest(validParams, {
      ...validQuery,
      validTime: '2026-02-29T06:00:00.000Z', // 2026年は閏年ではない
    }),
    { ok: false, error: 'invalid_request' },
  );
});

test('parseKikikuruTileRequest: 正常系 - heavyrain, inund, land が正しくパースされる', () => {
  const layers = [
    { layer: 'heavyrain', imageId: 'rain_mesh' },
    { layer: 'inund', imageId: 'inund' },
    { layer: 'land', imageId: 'land' },
  ] as const;

  for (const { layer, imageId } of layers) {
    const params = { layer, z: '10', x: '800', y: '300' };
    const query = {
      terminalId: 'hkeagh01',
      controlStatus: 'normal',
      baseTime: '2026-09-14T06:00:00.000Z',
      validTime: '2026-09-14T06:05:00.000Z',
      imageId,
      member: 'none',
    };

    const res = parseKikikuruTileRequest(params, query);
    assert.deepEqual(res, {
      ok: true,
      value: {
        terminalId: 'hkeagh01',
        controlStatus: 'normal',
        coordinate: { zoom: 10, tileX: 800, tileY: 300 },
        frame: {
          layer,
          baseTime: '2026-09-14T06:00:00.000Z',
          validTime: '2026-09-14T06:05:00.000Z',
          imageId,
          member: 'none',
        },
      },
    });
  }
});

test('parseKikikuruTileRequest: 異常系 - layer 不正、layer と imageId の不一致、危険な member は invalid_request', () => {
  const validParams = { layer: 'heavyrain', z: '10', x: '800', y: '300' };
  const validQuery = {
    terminalId: 'hkeagh01',
    controlStatus: 'normal',
    baseTime: '2026-09-14T06:00:00.000Z',
    validTime: '2026-09-14T06:05:00.000Z',
    imageId: 'rain_mesh',
    member: 'none',
  };

  // layer 不正 (flood 等)
  assert.deepEqual(parseKikikuruTileRequest({ ...validParams, layer: 'flood' }, validQuery), {
    ok: false,
    error: 'invalid_request',
  });

  // layer と imageId の不一致
  assert.deepEqual(parseKikikuruTileRequest(validParams, { ...validQuery, imageId: 'inund' }), {
    ok: false,
    error: 'invalid_request',
  });

  // 危険な member (パス区切り、..、制御文字、空文字)
  assert.deepEqual(
    parseKikikuruTileRequest(validParams, { ...validQuery, member: '../traversal' }),
    { ok: false, error: 'invalid_request' },
  );
  assert.deepEqual(parseKikikuruTileRequest(validParams, { ...validQuery, member: 'sub/dir' }), {
    ok: false,
    error: 'invalid_request',
  });
  assert.deepEqual(parseKikikuruTileRequest(validParams, { ...validQuery, member: 'sub\\dir' }), {
    ok: false,
    error: 'invalid_request',
  });
  assert.deepEqual(parseKikikuruTileRequest(validParams, { ...validQuery, member: 'foo\x00bar' }), {
    ok: false,
    error: 'invalid_request',
  });
  assert.deepEqual(parseKikikuruTileRequest(validParams, { ...validQuery, member: '' }), {
    ok: false,
    error: 'invalid_request',
  });
});
