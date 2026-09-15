import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKikikuruTimesResponse, fetchKikikuruTimes } from '../src/api/kikikuruTimes';
import { createSampleKikikuruResponse } from './fixtures/kikikuruFixtures';

test('kikikuruTimes: 正常なレスポンス JSON を正しくパースすること', () => {
  const sample = createSampleKikikuruResponse();
  const parsed = parseKikikuruTimesResponse(sample);
  assert.ok(parsed !== null);
  assert.equal(parsed.terminalId, 'hkeagh01');
  assert.equal(parsed.status, 'ok');
  assert.ok(parsed.layers.heavyrain);
  assert.ok(parsed.layers.inund);
  assert.ok(parsed.layers.land);
});

test('kikikuruTimes: 不正なレスポンスでは null を返すこと', () => {
  assert.equal(parseKikikuruTimesResponse(null), null);
  assert.equal(parseKikikuruTimesResponse('string'), null);
  assert.equal(parseKikikuruTimesResponse({ terminalId: 'test' }), null); // layers 欠落
});

test('fetchKikikuruTimes: 正しい path とクエリで fetchTileCatalog を呼ぶこと (§6.1)', async () => {
  const sample = createSampleKikikuruResponse();
  let requestedUrl = '';

  const mockFetch: typeof fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify(sample), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const controller = new AbortController();
  const result = await fetchKikikuruTimes({
    terminalId: 'hkeagh01',
    controlStatus: 'normal',
    signal: controller.signal,
    fetchImpl: mockFetch,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.terminalId, 'hkeagh01');
  }

  assert.ok(requestedUrl.startsWith('/api/weather/kikikuru/times?'));
  const query = new URLSearchParams(requestedUrl.split('?')[1]);
  assert.equal(query.get('terminalId'), 'hkeagh01');
  assert.equal(query.get('controlStatus'), 'normal');
});
