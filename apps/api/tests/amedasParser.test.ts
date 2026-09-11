import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseAmedasLatestTime, parseAmedasPointBlock } from '../src/polling/amedasParser.js';
import { resolveAmedasTarget } from '../src/venueForecastTargets.js';

const fixturesDir = join(fileURLToPath(import.meta.url), '../fixtures/jma/amedas');

const latestTimeText = readFileSync(join(fixturesDir, 'amedas_latest_time.txt'), 'utf-8');
const point44136Json = readFileSync(join(fixturesDir, 'amedas_point_44136_block.json'), 'utf-8');
const point44166Json = readFileSync(join(fixturesDir, 'amedas_point_44166_block.json'), 'utf-8');
const point44136SyntheticJson = readFileSync(
  join(fixturesDir, 'amedas_point_44136_synthetic.json'),
  'utf-8',
);
const point44166SyntheticWithHumidityJson = readFileSync(
  join(fixturesDir, 'amedas_point_44166_synthetic_with_humidity.json'),
  'utf-8',
);

test('parseAmedasLatestTime: 正常系および異常系', () => {
  // 原文 fixture
  const res1 = parseAmedasLatestTime(latestTimeText);
  assert.equal(res1.ok, true);
  if (res1.ok) {
    assert.equal(res1.value, '2026-09-11T11:40:00.000Z');
  }

  // 前後空白・改行
  const res2 = parseAmedasLatestTime('  \n2026-09-11T19:50:00+09:00\r\n  ');
  assert.equal(res2.ok, true);
  if (res2.ok) {
    assert.equal(res2.value, '2026-09-11T10:50:00.000Z');
  }

  // 異常系
  assert.equal(parseAmedasLatestTime('').ok, false);
  assert.equal(parseAmedasLatestTime('not a time').ok, false);
  assert.equal(parseAmedasLatestTime('2026-09-11 19:50:00').ok, false);
  assert.equal(parseAmedasLatestTime('2026-99-99T99:99:99Z').ok, false);
});

test('parseAmedasPointBlock: east（江戸川臨海）原文 fixture 正規化', () => {
  const eastTarget = resolveAmedasTarget('east');
  const res = parseAmedasPointBlock(point44136Json, eastTarget);
  assert.equal(res.ok, true);
  if (!res.ok) return;

  const norm = res.value;
  assert.equal(norm.latestObservedAt, '2026-09-11T11:40:00.000Z');
  assert.equal(norm.observedTimeCount, 17);

  // temp / humidity / windDirection / wind / precipitation1h の行が各時刻分存在すること
  for (const el of ['temp', 'humidity', 'windDirection', 'wind', 'precipitation1h']) {
    const count = norm.observations.filter((o) => o.element === el).length;
    assert.equal(count, 17, `element ${el} count`);
  }

  // observedAt が UTC ISO 8601
  const sampleObs = norm.observations.find((o) => o.element === 'temp');
  assert.ok(sampleObs);
  assert.match(sampleObs.observedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

  // snow* / pressure 系の行が1件も作られないこと
  assert.equal(
    norm.observations.some(
      (o) =>
        o.element.startsWith('snow') ||
        o.element.includes('pressure') ||
        o.element.includes('Pressure'),
    ),
    false,
  );

  // [0, null] 形の要素が unsupportedElementCount に計上され、value_number = 0 として保存されないこと
  assert.ok(norm.unsupportedElementCount > 0);
  assert.equal(
    norm.observations.some((o) => o.element === 'snow1h' && o.valueNumber === 0),
    false,
  );

  // 推計フラグ: sun10m / sun1h の行はすべて isEstimated === true
  const sunObs = norm.observations.filter((o) => o.element === 'sun10m' || o.element === 'sun1h');
  assert.ok(sunObs.length > 0);
  assert.ok(sunObs.every((o) => o.isEstimated === true));

  // temp / humidity / windDirection / wind / precipitation1h はすべて isEstimated === false
  const nonSunObs = norm.observations.filter((o) =>
    ['temp', 'humidity', 'windDirection', 'wind', 'precipitation1h'].includes(o.element),
  );
  assert.ok(nonSunObs.every((o) => o.isEstimated === false));
  assert.equal(norm.estimatedElementCount, sunObs.length);

  // prefNumber / observationNumber が保存されていないこと
  assert.equal(
    norm.observations.some((o) => o.element === 'prefNumber' || o.element === 'observationNumber'),
    false,
  );

  // windDirection がコード値のまま（数値）保存されていること
  const windDirObs = norm.observations.filter((o) => o.element === 'windDirection');
  assert.ok(windDirObs.every((o) => typeof o.valueNumber === 'number' && o.valueText === null));
});

test('parseAmedasPointBlock: east 合成 fixture による欠測・AQC・未知キーの検証', () => {
  const eastTarget = resolveAmedasTarget('east');
  const res = parseAmedasPointBlock(point44136SyntheticJson, eastTarget);
  assert.equal(res.ok, true);
  if (!res.ok) return;

  const norm = res.value;
  const latestObsAt = '2026-09-11T11:40:00.000Z';
  const latestObs = norm.observations.filter((o) => o.observedAt === latestObsAt);

  // 1. [null, 0] 形 (precipitation10m): 行が作られ、valueNumber === null, qualityFlag === 0
  const prec10m = latestObs.find((o) => o.element === 'precipitation10m');
  assert.ok(prec10m);
  assert.equal(prec10m.valueNumber, null);
  assert.equal(prec10m.qualityFlag, 0);

  // 2. [23.4, 1] / [2.1, 4] 形: 通常値として保存
  const tempObs = latestObs.find((o) => o.element === 'temp');
  assert.ok(tempObs);
  assert.equal(tempObs.valueNumber, 23.4);
  assert.equal(tempObs.qualityFlag, 1);
  const windObs = latestObs.find((o) => o.element === 'wind');
  assert.ok(windObs);
  assert.equal(windObs.valueNumber, 2.1);
  assert.equal(windObs.qualityFlag, 4);

  // 3. [0.0, 2] / [0.0, 3] 形: 通常値として保存
  const prec1h = latestObs.find((o) => o.element === 'precipitation1h');
  assert.ok(prec1h);
  assert.equal(prec1h.valueNumber, 0.0);
  assert.equal(prec1h.qualityFlag, 2);
  const prec3h = latestObs.find((o) => o.element === 'precipitation3h');
  assert.ok(prec3h);
  assert.equal(prec3h.valueNumber, 0.0);
  assert.equal(prec3h.qualityFlag, 3);

  // 4. [23.4, 5] (gust) / [15.5, 6] (precipitation24h): AQC 5/6 は欠測化
  const gustObs = latestObs.find((o) => o.element === 'gust');
  assert.ok(gustObs);
  assert.equal(gustObs.valueNumber, null);
  assert.equal(gustObs.valueText, null);
  assert.equal(gustObs.qualityFlag, 5);

  const prec24h = latestObs.find((o) => o.element === 'precipitation24h');
  assert.ok(prec24h);
  assert.equal(prec24h.valueNumber, null);
  assert.equal(prec24h.valueText, null);
  assert.equal(prec24h.qualityFlag, 6);

  // qualitySuppressedCount: gust と precipitation24h と sun10m(AQC 5) で計上
  // sun10m も [10, 5] なので欠測化され qualityFlag=5
  const sun10m = latestObs.find((o) => o.element === 'sun10m');
  assert.ok(sun10m);
  assert.equal(sun10m.valueNumber, null);
  assert.equal(sun10m.qualityFlag, 5);
  assert.equal(sun10m.isEstimated, true, 'AQC 5 で欠測化しても推計フラグは保持される');

  // 推計要素の通常の欠測 [null, 0]
  const sun1h = latestObs.find((o) => o.element === 'sun1h');
  assert.ok(sun1h);
  assert.equal(sun1h.valueNumber, null);
  assert.equal(sun1h.qualityFlag, 0);
  assert.equal(sun1h.isEstimated, true, '通常の欠測でも推計フラグは保持される');

  // 未知キー experimentalValue: [1.0, 0] が保存され isEstimated === false
  const expObs = latestObs.find((o) => o.element === 'experimentalValue');
  assert.ok(expObs);
  assert.equal(expObs.valueNumber, 1.0);
  assert.equal(expObs.qualityFlag, 0);
  assert.equal(expObs.isEstimated, false);

  // maxTempTime: {hour, minute} の検証
  const maxTempTimeObs = latestObs.find((o) => o.element === 'maxTempTime');
  assert.ok(maxTempTimeObs);
  assert.equal(maxTempTimeObs.valueNumber, null);
  assert.match(maxTempTimeObs.valueText ?? '', /^\d{2}:\d{2}$/);
  assert.equal(maxTempTimeObs.qualityFlag, null);

  // qualitySuppressedCount が missingValueCount の内数であること
  assert.ok(norm.qualitySuppressedCount > 0);
  assert.ok(norm.missingValueCount >= norm.qualitySuppressedCount);
});

test('parseAmedasPointBlock: trc（羽田）正規化および east との対比', () => {
  const trcTarget = resolveAmedasTarget('trc');
  const res = parseAmedasPointBlock(point44166Json, trcTarget);
  assert.equal(res.ok, true);
  if (!res.ok) return;

  const norm = res.value;
  // 羽田は humidity / sun10m / sun1h / snow* / pressure が1件も無いこと
  assert.equal(
    norm.observations.some((o) => o.element === 'humidity'),
    false,
  );
  assert.equal(
    norm.observations.some((o) => o.element === 'sun10m' || o.element === 'sun1h'),
    false,
  );
  assert.equal(
    norm.observations.some((o) => o.element.startsWith('snow')),
    false,
  );
  assert.equal(
    norm.observations.some((o) => o.element.includes('pressure') || o.element.includes('Pressure')),
    false,
  );

  // temp, precipitation1h, precipitation24h, windDirection, wind は各時刻分存在すること
  for (const el of ['temp', 'precipitation1h', 'precipitation24h', 'windDirection', 'wind']) {
    const count = norm.observations.filter((o) => o.element === el).length;
    assert.equal(count, 17, `element ${el} count`);
  }

  // 羽田の行には is_estimated === true の行が1件も無いこと
  assert.equal(
    norm.observations.some((o) => o.isEstimated),
    false,
  );
  assert.equal(norm.estimatedElementCount, 0);

  // 合成 fixture (humidity: [55, 0] 入り) の対比テスト
  const trcWithHumRes = parseAmedasPointBlock(point44166SyntheticWithHumidityJson, trcTarget);
  assert.equal(trcWithHumRes.ok, true);
  if (trcWithHumRes.ok) {
    assert.equal(
      trcWithHumRes.value.observations.some((o) => o.element === 'humidity'),
      false,
    );
    assert.ok(trcWithHumRes.value.unsupportedElementCount > 0);
  }

  // 同一データ構造（humidity: [55, 0]）を east の target で正規化すると valueNumber === 55 の行が作られること
  const eastTarget = resolveAmedasTarget('east');
  // 44136 向けに observationNumber だけ 136 に置換した同一データを用意
  const eastWithHumJson = point44166SyntheticWithHumidityJson.replace(
    /"observationNumber":\s*166/g,
    '"observationNumber": 136',
  );
  const eastWithHumRes = parseAmedasPointBlock(eastWithHumJson, eastTarget);
  assert.equal(eastWithHumRes.ok, true);
  if (eastWithHumRes.ok) {
    const humObs = eastWithHumRes.value.observations.find((o) => o.element === 'humidity');
    assert.ok(humObs, 'east では humidity の行が作られること');
    assert.equal(humObs.valueNumber, 55);
    assert.equal(humObs.isEstimated, false);
  }
});

test('parseAmedasPointBlock: 構造検証による ok: false（例外なし）', () => {
  const eastTarget = resolveAmedasTarget('east');

  // 1. JSON 不正
  assert.equal(parseAmedasPointBlock('not json', eastTarget).ok, false);

  // 2. トップレベルが配列
  assert.equal(parseAmedasPointBlock('[]', eastTarget).ok, false);

  // 3. 空オブジェクト
  assert.equal(parseAmedasPointBlock('{}', eastTarget).ok, false);

  // 4. 観測時刻キー形式不正
  assert.equal(
    parseAmedasPointBlock(
      JSON.stringify({
        '20260911_1800': { prefNumber: 44, observationNumber: 136, temp: [20.0, 0] },
      }),
      eastTarget,
    ).ok,
    false,
  );

  // 5. 地点コード不一致 (observationNumber が 137)
  assert.equal(
    parseAmedasPointBlock(
      JSON.stringify({
        '20260911180000': { prefNumber: 44, observationNumber: 137, temp: [20.0, 0] },
      }),
      eastTarget,
    ).ok,
    false,
  );
});

test('parseAmedasPointBlock: AQC が null 以外の非数値なら未知形状として行を作らない', () => {
  const eastTarget = resolveAmedasTarget('east');
  const result = parseAmedasPointBlock(
    JSON.stringify({
      '20260911180000': {
        prefNumber: 44,
        observationNumber: 136,
        temp: [20.0, 'invalid-aqc'],
      },
    }),
    eastTarget,
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.observations, []);
  assert.equal(result.value.unknownShapeCount, 1);
});
