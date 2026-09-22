import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isKikikuruLayer,
  toApiLayer,
  toMapLayerId,
  toTimelineFrames,
  resolveKikikuruFrame,
  buildKikikuruCatalog,
} from '../src/map/kikikuru/kikikuruCatalog';
import {
  createSampleKikikuruFrames,
  createSampleKikikuruResponse,
} from './fixtures/kikikuruFixtures';

test('kikikuruCatalog: レイヤー ID 相互変換と判定が正確であること', () => {
  assert.equal(isKikikuruLayer('kikikuru-heavyrain'), true);
  assert.equal(isKikikuruLayer('kikikuru-inund'), true);
  assert.equal(isKikikuruLayer('kikikuru-land'), true);
  assert.equal(isKikikuruLayer('nowcast'), false);

  assert.equal(toApiLayer('kikikuru-heavyrain'), 'heavyrain');
  assert.equal(toApiLayer('kikikuru-inund'), 'inund');
  assert.equal(toApiLayer('kikikuru-land'), 'land');

  assert.equal(toMapLayerId('heavyrain'), 'kikikuru-heavyrain');
  assert.equal(toMapLayerId('inund'), 'kikikuru-inund');
  assert.equal(toMapLayerId('land'), 'kikikuru-land');
});

test('toTimelineFrames: 索引の最新 validTime の1コマだけを返すこと (§6.4, §11.4.1)', () => {
  const latestTime = '2026-09-15T03:00:00.000Z';
  const frames = createSampleKikikuruFrames('heavyrain', latestTime, 37);

  const timelineFrames = toTimelineFrames(frames);
  assert.equal(timelineFrames.length, 1);
  assert.equal(timelineFrames[0]?.validTime, latestTime);
});

test('toTimelineFrames: 生成した TimelineFrame の kind が全件 reference であること (§11.7)', () => {
  const latestTime = '2026-09-15T03:00:00.000Z';
  const frames = createSampleKikikuruFrames('land', latestTime, 20);

  const timelineFrames = toTimelineFrames(frames);
  assert.ok(timelineFrames.length > 0);

  for (const frame of timelineFrames) {
    assert.equal(frame.kind, 'reference');
    assert.equal(frame.enabled, true);
    // frameId は validTime のみから生成され、member を含めない
    assert.equal(frame.id, frame.validTime);
    assert.ok(!frame.id.includes('immed'));
    assert.ok(!frame.id.includes('none'));
  }
});

test('toTimelineFrames: 空配列や無効データでは空配列を返すこと', () => {
  assert.deepEqual(toTimelineFrames([]), []);
  assert.deepEqual(toTimelineFrames(null as unknown as []), []);
});

test('resolveKikikuruFrame: 最新索引から validTime で最新のコマ情報（member ドリフト）を引き直せること (§6.3)', () => {
  const latestTime = '2026-09-15T03:00:00.000Z';
  const frames = createSampleKikikuruFrames('inund', latestTime, 37);

  // 03:00 は最新なので immed0
  const f0 = resolveKikikuruFrame(frames, '2026-09-15T03:00:00.000Z');
  assert.ok(f0 !== null);
  assert.equal(f0.member, 'immed0');
  assert.equal(f0.imageId, 'inund');

  // 02:50 は immed1
  const f1 = resolveKikikuruFrame(frames, '2026-09-15T02:50:00.000Z');
  assert.ok(f1 !== null);
  assert.equal(f1.member, 'immed1');

  // 存在しない時刻は null
  const fNone = resolveKikikuruFrame(frames, '2020-01-01T00:00:00.000Z');
  assert.equal(fNone, null);
});

test('buildKikikuruCatalog: 正常応答からカタログを構築すること', () => {
  const response = createSampleKikikuruResponse();
  const catalog = buildKikikuruCatalog(response);

  assert.equal(catalog.context.terminalId, 'hkeagh01');
  assert.deepEqual(catalog.allowedZooms, [10]);
  assert.ok(catalog.layers.heavyrain.data?.frames.length === 37);
  assert.ok(catalog.layers.inund.data?.frames.length === 37);
  assert.ok(catalog.layers.land.data?.frames.length === 37);
});

test('buildKikikuruCatalog: unsupported_control_status の応答で allowedZooms が空配列になること (§11.8)', () => {
  const response = createSampleKikikuruResponse({
    status: 'unsupported_control_status',
    allowedZooms: [],
  });
  const catalog = buildKikikuruCatalog(response);

  assert.deepEqual(catalog.allowedZooms, []);
});
