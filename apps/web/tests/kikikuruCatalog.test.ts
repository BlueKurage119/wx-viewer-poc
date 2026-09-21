import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isKikikuruLayer,
  toApiLayer,
  toMapLayerId,
  toTimelineFrames,
  resolveKikikuruFrame,
  buildKikikuruCatalog,
  KIKIKURU_DISPLAY_WINDOW_MS,
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

test('toTimelineFrames: 索引の最新 validTime を基準に過去3時間窓を適用し、クライアントの Date.now() に依存しないこと (§11.4.1)', () => {
  const latestTime = '2026-09-15T03:00:00.000Z';
  const frames = createSampleKikikuruFrames('heavyrain', latestTime, 37);

  // 1. 引数 now を渡さない場合
  const result1 = toTimelineFrames(frames);

  // 2. 引数 now に未来の日時を渡した場合
  const futureNow = new Date('2026-12-31T23:59:59.000Z');
  const result2 = toTimelineFrames(frames, futureNow);

  // 3. 引数 now に過去の日時を渡した場合
  const pastNow = new Date('2020-01-01T00:00:00.000Z');
  const result3 = toTimelineFrames(frames, pastNow);

  // クライアントの時計に依存せず、常に同一のコマ一覧が返る
  assert.equal(result1.length, result2.length);
  assert.equal(result1.length, result3.length);
  assert.deepEqual(result1, result2);
  assert.deepEqual(result1, result3);
});

test('toTimelineFrames: ちょうど3時間前のコマが含まれる (閉区間) こと (§11.4.1)', () => {
  const latestTime = '2026-09-15T03:00:00.000Z'; // 03:00
  // 10分刻み37コマ (03:00 から過去6時間＝前日 21:00 まで)
  const frames = createSampleKikikuruFrames('heavyrain', latestTime, 37);

  const timelineFrames = toTimelineFrames(frames);

  // 03:00 から過去 3 時間 (180分) ＝ 00:00
  // 10分刻みで 00:00, 00:10, ..., 03:00 のちょうど 19 コマになる
  assert.equal(timelineFrames.length, 19);

  // 最古コマがちょうど 3 時間前の 00:00:00.000Z
  const oldestFrame = timelineFrames[0]!;
  assert.equal(oldestFrame.validTime, '2026-09-15T00:00:00.000Z');

  // 最新コマが 03:00:00.000Z
  const latestFrame = timelineFrames[timelineFrames.length - 1]!;
  assert.equal(latestFrame.validTime, '2026-09-15T03:00:00.000Z');

  // 差分がちょうど 3 時間 (180 分)
  const diffMs = Date.parse(latestFrame.validTime) - Date.parse(oldestFrame.validTime);
  assert.equal(diffMs, KIKIKURU_DISPLAY_WINDOW_MS);
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
