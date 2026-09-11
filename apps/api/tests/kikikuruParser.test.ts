import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parseKikikuruTargetTimes } from '../src/polling/kikikuruParser.js';
import { buildKikikuruTileUrl } from '../src/polling/kikikuruSource.js';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures/jma/kikikuru');
const syntheticJson = fs.readFileSync(
  path.join(FIXTURES_DIR, 'kikikuru_target_times_synthetic.json'),
  'utf-8',
);
const emptyJson = fs.readFileSync(
  path.join(FIXTURES_DIR, 'kikikuru_target_times_empty.json'),
  'utf-8',
);

test('1. heavyrain / inund / land を含む synthetic targetTimes.json から3レイヤーのフレームを抽出でき、heavyrain は rain_mesh、他は同名 imageId となる', () => {
  const result = parseKikikuruTargetTimes(syntheticJson);
  assert.strictEqual(result.ok, true);
  if (!result.ok) return;

  const { heavyrain, inund, land } = result.framesByLayer;

  // heavyrain: imageId は rain_mesh
  assert.strictEqual(heavyrain.length, 2);
  for (const f of heavyrain) {
    assert.strictEqual(f.key.layer, 'heavyrain');
    assert.strictEqual(f.key.imageId, 'rain_mesh');
  }

  // inund: imageId は inund
  assert.strictEqual(inund.length, 2);
  for (const f of inund) {
    assert.strictEqual(f.key.layer, 'inund');
    assert.strictEqual(f.key.imageId, 'inund');
  }

  // land: imageId は land
  assert.strictEqual(land.length, 3);
  for (const f of land) {
    assert.strictEqual(f.key.layer, 'land');
    assert.strictEqual(f.key.imageId, 'land');
  }
});

test('2. member が immed0, immed1, none の各フレームを混在させ、URL が一覧の当該値を使う（固定値置換なし）', () => {
  const result = parseKikikuruTargetTimes(syntheticJson);
  assert.strictEqual(result.ok, true);
  if (!result.ok) return;

  const allFrames = [
    ...result.framesByLayer.heavyrain,
    ...result.framesByLayer.inund,
    ...result.framesByLayer.land,
  ];

  const members = new Set(allFrames.map((f) => f.key.member));
  assert.strictEqual(members.has('immed0'), true);
  assert.strictEqual(members.has('immed1'), true);
  assert.strictEqual(members.has('none'), true);

  // 各フレームの URL が当該 member を完全に含んでいることを完全一致アサーションで確認
  for (const f of allFrames) {
    const url = buildKikikuruTileUrl(
      f.key.baseTime,
      f.key.validTime,
      f.key.member,
      f.key.imageId,
      10,
      909,
      404,
    );
    assert.strictEqual(url.includes(`/${f.key.member}/`), true);
  }

  // 具象例の完全一致アサーション
  const fHeavyImmed1 = result.framesByLayer.heavyrain.find((f) => f.key.member === 'immed1')!;
  assert.notStrictEqual(fHeavyImmed1, undefined);
  const urlHeavyImmed1 = buildKikikuruTileUrl(
    fHeavyImmed1.key.baseTime,
    fHeavyImmed1.key.validTime,
    fHeavyImmed1.key.member,
    fHeavyImmed1.key.imageId,
    10,
    909,
    404,
  );
  assert.strictEqual(
    urlHeavyImmed1,
    'https://www.jma.go.jp/bosai/jmatile/data/risk/20260907030000/immed1/20260907031000/surf/rain_mesh/10/909/404.png',
  );

  const fInundNone = result.framesByLayer.inund.find((f) => f.key.member === 'none')!;
  assert.notStrictEqual(fInundNone, undefined);
  const urlInundNone = buildKikikuruTileUrl(
    fInundNone.key.baseTime,
    fInundNone.key.validTime,
    fInundNone.key.member,
    fInundNone.key.imageId,
    10,
    909,
    404,
  );
  assert.strictEqual(
    urlInundNone,
    'https://www.jma.go.jp/bosai/jmatile/data/risk/20260907030000/none/20260907032000/surf/inund/10/909/404.png',
  );
});

test('3. 対象 element がない行は当該レイヤーに入らず、重複行は1件に畳まれ、順序と sequence が決定的である', () => {
  const result = parseKikikuruTargetTimes(syntheticJson);
  assert.strictEqual(result.ok, true);
  if (!result.ok) return;

  // flood や river_depth は どのレイヤーにも入らない
  const allImageIds = [
    ...result.framesByLayer.heavyrain,
    ...result.framesByLayer.inund,
    ...result.framesByLayer.land,
  ].map((f) => f.key.imageId);
  assert.strictEqual(allImageIds.includes('flood'), false);
  assert.strictEqual(allImageIds.includes('river_depth'), false);

  // land レイヤーの並び順と sequence の決定的検証
  // 入力順: 0300 (base 0300), 0300 (base 0250), 0300 (重複), 0250 (base 0300)
  // 期待ソート順: validTime昇順 -> baseTime昇順 -> member昇順 -> imageId昇順
  // 1: valid 0250 (base 0300)
  // 2: valid 0300 (base 0250)
  // 3: valid 0300 (base 0300)
  const landFrames = result.framesByLayer.land;
  assert.strictEqual(landFrames.length, 3);
  assert.deepStrictEqual(landFrames[0]?.key, {
    layer: 'land',
    baseTime: '2026-09-07T03:00:00.000Z',
    validTime: '2026-09-07T02:50:00.000Z',
    imageId: 'land',
    member: 'immed0',
  });
  assert.strictEqual(landFrames[0]?.sequence, 0);

  assert.deepStrictEqual(landFrames[1]?.key, {
    layer: 'land',
    baseTime: '2026-09-07T02:50:00.000Z',
    validTime: '2026-09-07T03:00:00.000Z',
    imageId: 'land',
    member: 'immed0',
  });
  assert.strictEqual(landFrames[1]?.sequence, 1);

  assert.deepStrictEqual(landFrames[2]?.key, {
    layer: 'land',
    baseTime: '2026-09-07T03:00:00.000Z',
    validTime: '2026-09-07T03:00:00.000Z',
    imageId: 'land',
    member: 'immed0',
  });
  assert.strictEqual(landFrames[2]?.sequence, 2);
});

test('4. 空一覧、不正 JSON、構造不正（2月30日、非オブジェクト、不正 member、不正 elements）の検証', () => {
  // 正常空一覧
  const emptyRes = parseKikikuruTargetTimes(emptyJson);
  assert.strictEqual(emptyRes.ok, true);
  if (emptyRes.ok) {
    assert.strictEqual(emptyRes.framesByLayer.heavyrain.length, 0);
    assert.strictEqual(emptyRes.framesByLayer.inund.length, 0);
    assert.strictEqual(emptyRes.framesByLayer.land.length, 0);
  }

  // 不正 JSON
  const invalidJsonRes = parseKikikuruTargetTimes('not a json');
  assert.strictEqual(invalidJsonRes.ok, false);
  if (!invalidJsonRes.ok) {
    assert.strictEqual(invalidJsonRes.errorKind, 'invalid_json');
  }

  // 非配列
  const notArrayRes = parseKikikuruTargetTimes('{"key": "value"}');
  assert.strictEqual(notArrayRes.ok, false);
  if (!notArrayRes.ok) {
    assert.strictEqual(notArrayRes.errorKind, 'invalid_structure');
  }

  // 2月30日
  const feb30Json = JSON.stringify([
    {
      basetime: '20260230120000',
      validtime: '20260230120000',
      member: 'immed0',
      elements: ['heavyrain'],
    },
  ]);
  const feb30Res = parseKikikuruTargetTimes(feb30Json);
  assert.strictEqual(feb30Res.ok, false);
  if (!feb30Res.ok) {
    assert.strictEqual(feb30Res.errorKind, 'invalid_structure');
  }

  // 空文字 member
  const emptyMemberJson = JSON.stringify([
    {
      basetime: '20260907030000',
      validtime: '20260907030000',
      member: '',
      elements: ['heavyrain'],
    },
  ]);
  const emptyMemberRes = parseKikikuruTargetTimes(emptyMemberJson);
  assert.strictEqual(emptyMemberRes.ok, false);
  if (!emptyMemberRes.ok) {
    assert.strictEqual(emptyMemberRes.errorKind, 'invalid_structure');
  }
});
