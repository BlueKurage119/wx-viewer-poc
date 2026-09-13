import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWeatherApiQuery } from '../src/weatherApi.js';

test('parseWeatherApiQuery: 正常系 - terminalId と controlStatus が正しくパースされる', () => {
  const query1 = { terminalId: 'hkeagh01', controlStatus: 'normal' };
  assert.deepEqual(parseWeatherApiQuery(query1), {
    ok: true,
    value: { terminalId: 'hkeagh01', controlStatus: 'normal' },
  });

  const query2 = { terminalId: 'htrcph01', controlStatus: 'training' };
  assert.deepEqual(parseWeatherApiQuery(query2), {
    ok: true,
    value: { terminalId: 'htrcph01', controlStatus: 'training' },
  });

  const query3 = { terminalId: 'kkeagh01', controlStatus: 'test' };
  assert.deepEqual(parseWeatherApiQuery(query3), {
    ok: true,
    value: { terminalId: 'kkeagh01', controlStatus: 'test' },
  });
});

test('parseWeatherApiQuery: 異常系 - パラメーター欠落・余剰キー・型不正・不正値は invalid_request になる', () => {
  // 非オブジェクト・null・配列
  assert.deepEqual(parseWeatherApiQuery(null), { ok: false, error: 'invalid_request' });
  assert.deepEqual(parseWeatherApiQuery(undefined), { ok: false, error: 'invalid_request' });
  assert.deepEqual(parseWeatherApiQuery(''), { ok: false, error: 'invalid_request' });
  assert.deepEqual(parseWeatherApiQuery([]), { ok: false, error: 'invalid_request' });

  // 欠落
  assert.deepEqual(parseWeatherApiQuery({ terminalId: 'hkeagh01' }), {
    ok: false,
    error: 'invalid_request',
  });
  assert.deepEqual(parseWeatherApiQuery({ controlStatus: 'normal' }), {
    ok: false,
    error: 'invalid_request',
  });

  // 未知キー
  assert.deepEqual(
    parseWeatherApiQuery({
      terminalId: 'hkeagh01',
      controlStatus: 'normal',
      extra: 'value',
    }),
    { ok: false, error: 'invalid_request' },
  );

  // 会場 ID を同時に指定して上書きする経路は設けない（§3.1）
  assert.deepEqual(
    parseWeatherApiQuery({
      terminalId: 'hkeagh01',
      controlStatus: 'normal',
      venueId: 'east',
    }),
    { ok: false, error: 'invalid_request' },
  );

  // 空文字
  assert.deepEqual(
    parseWeatherApiQuery({
      terminalId: '',
      controlStatus: 'normal',
    }),
    { ok: false, error: 'invalid_request' },
  );
  assert.deepEqual(
    parseWeatherApiQuery({
      terminalId: '   ',
      controlStatus: 'normal',
    }),
    { ok: false, error: 'invalid_request' },
  );

  // 配列（重複キーなど）
  assert.deepEqual(
    parseWeatherApiQuery({
      terminalId: ['hkeagh01', 'htrcph01'],
      controlStatus: 'normal',
    }),
    { ok: false, error: 'invalid_request' },
  );
  assert.deepEqual(
    parseWeatherApiQuery({
      terminalId: 'hkeagh01',
      controlStatus: ['normal', 'training'],
    }),
    { ok: false, error: 'invalid_request' },
  );

  // 不正な controlStatus
  assert.deepEqual(
    parseWeatherApiQuery({
      terminalId: 'hkeagh01',
      controlStatus: 'invalid',
    }),
    { ok: false, error: 'invalid_request' },
  );
  assert.deepEqual(
    parseWeatherApiQuery({
      terminalId: 'hkeagh01',
      controlStatus: 'Normal',
    }),
    { ok: false, error: 'invalid_request' },
  );
});
