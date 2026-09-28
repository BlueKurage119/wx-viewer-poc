import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AreaTimeseriesData } from '@wx-viewer-poc/shared';
import {
  buildAreaForecastModel,
  selectPanelColumns,
  resolveAreaForecastTargets,
  formatWeatherAriaLabel,
  formatWindAriaLabel,
  formatTemperatureAriaLabel,
  buildTemperatureView,
} from '../src/map/panels/areaForecast/areaForecastModel';
import { buildWeatherView } from '../src/map/panels/areaForecast/weatherIconMap';
import { buildLevelView } from '../src/map/panels/areaForecast/windSpeedLevel';

function sampleDto(): AreaTimeseriesData {
  return {
    station: { code: '44132', name: '東京' },
    timeDefines: [
      {
        blockId: 'region-3hour',
        timeId: '1',
        sequence: 1,
        timeFrom: '2026-09-28T00:00:00Z', // 9時JST
        timeTo: '2026-09-28T03:00:00Z', // 12時JST
        duration: 'PT3H',
      },
      {
        blockId: 'region-3hour',
        timeId: '2',
        sequence: 2,
        timeFrom: '2026-09-28T03:00:00Z', // 12時JST
        timeTo: '2026-09-28T06:00:00Z', // 15時JST
        duration: 'PT3H',
      },
      {
        blockId: 'temperature-3hour',
        timeId: 't1',
        sequence: 1,
        timeFrom: '2026-09-28T00:00:00Z', // 9時JST
        timeTo: '2026-09-28T00:00:00Z',
        duration: null,
      },
      {
        blockId: 'temperature-3hour',
        timeId: 't2',
        sequence: 2,
        timeFrom: '2026-09-28T03:00:00Z', // 12時JST
        timeTo: '2026-09-28T03:00:00Z',
        duration: null,
      },
      {
        blockId: 'temperature-3hour',
        timeId: 't3',
        sequence: 3,
        timeFrom: '2026-09-28T06:00:00Z', // 15時JST (区間の無い最終列)
        timeTo: '2026-09-28T06:00:00Z',
        duration: null,
      },
    ],
    values: [
      {
        blockId: 'region-3hour',
        refId: '1',
        element: 'weather',
        valueCode: null,
        valueText: 'くもり',
        valueNumber: null,
        unit: null,
        sequence: 1,
      },
      {
        blockId: 'region-3hour',
        refId: '1',
        element: 'wind_direction',
        valueCode: null,
        valueText: '北西',
        valueNumber: null,
        unit: '８方位漢字',
        sequence: 2,
      },
      {
        blockId: 'region-3hour',
        refId: '1',
        element: 'wind_speed_rank',
        valueCode: '2',
        valueText: null,
        valueNumber: null,
        unit: null,
        sequence: 3,
      },
      {
        blockId: 'region-3hour',
        refId: '2',
        element: 'weather',
        valueCode: null,
        valueText: '雨',
        valueNumber: null,
        unit: null,
        sequence: 4,
      },
      {
        blockId: 'temperature-3hour',
        refId: 't1',
        element: 'temperature',
        valueCode: null,
        valueText: null,
        valueNumber: 12,
        unit: '度',
        sequence: 1,
      },
      {
        blockId: 'temperature-3hour',
        refId: 't2',
        element: 'temperature',
        valueCode: null,
        valueText: null,
        valueNumber: -3,
        unit: '度',
        sequence: 2,
      },
      {
        blockId: 'temperature-3hour',
        refId: 't3',
        element: 'temperature',
        valueCode: null,
        valueText: null,
        valueNumber: 10,
        unit: '度',
        sequence: 3,
      },
    ],
  };
}

test('Issue #58 AC-2: values の順序シャッフル・refId結合・区間外最終列・重複値・補間なし', () => {
  const base = sampleDto();
  const model1 = buildAreaForecastModel(base);
  assert.equal(model1.kind, 'table');
  if (model1.kind !== 'table') return;

  // 列数は 3列 (9時JST, 12時JST, 15時JST)
  assert.equal(model1.columns.length, 3);
  assert.equal(model1.columns[0]!.intervalLabel, '9-12時');
  assert.equal(model1.columns[0]!.pointLabel, '9時');
  assert.equal(model1.columns[1]!.intervalLabel, '12-15時');
  assert.equal(model1.columns[1]!.pointLabel, '12時');
  // 最終列 (15時JST) は区間がないため intervalLabel は null、pointLabel は「15時」
  assert.equal(model1.columns[2]!.intervalLabel, null);
  assert.equal(model1.columns[2]!.pointLabel, '15時');

  // 9時の気温 (12℃) が「9-12時」列に置かれていること
  assert.equal(model1.points[0]!.kind, 'value');
  if (model1.points[0]!.kind === 'value') {
    assert.equal(model1.points[0]!.temperature.kind, 'value');
    if (model1.points[0]!.temperature.kind === 'value') {
      assert.equal(model1.points[0]!.temperature.text, '12℃');
    }
  }

  // 最終列の区間セルは none
  assert.equal(model1.intervals.length, 3);
  assert.equal(model1.intervals[2]!.kind, 'none');

  // シャッフルしても同じ表になること
  const shuffledDto = {
    ...base,
    values: [...base.values].reverse(),
  };
  const model2 = buildAreaForecastModel(shuffledDto);
  assert.deepEqual(model1, model2);

  // ブロックをまたいだ refId の不正結合がないこと (同一 refId '1' を temperature 側で使っても別)
  const crossBlockDto: AreaTimeseriesData = {
    ...base,
    timeDefines: [
      {
        blockId: 'region-3hour',
        timeId: '1',
        sequence: 1,
        timeFrom: '2026-09-28T00:00:00Z',
        timeTo: '2026-09-28T03:00:00Z',
        duration: 'PT3H',
      },
      {
        blockId: 'temperature-3hour',
        timeId: '1',
        sequence: 1,
        timeFrom: '2026-09-28T00:00:00Z',
        timeTo: '2026-09-28T00:00:00Z',
        duration: null,
      },
    ],
    values: [
      {
        blockId: 'region-3hour',
        refId: '1',
        element: 'weather',
        valueCode: null,
        valueText: '晴れ',
        valueNumber: null,
        unit: null,
        sequence: 1,
      },
      {
        blockId: 'temperature-3hour',
        refId: '1',
        element: 'temperature',
        valueCode: null,
        valueText: null,
        valueNumber: 20,
        unit: '度',
        sequence: 1,
      },
    ],
  };
  const crossModel = buildAreaForecastModel(crossBlockDto);
  assert.equal(crossModel.kind, 'table');
  if (crossModel.kind === 'table') {
    assert.equal(crossModel.intervals[0]!.kind, 'value');
    assert.equal(crossModel.points[0]!.kind, 'value');
  }

  // 対応 timeDefine のない値は捨てられる
  const droppedDto: AreaTimeseriesData = {
    ...base,
    values: [
      ...base.values,
      {
        blockId: 'region-3hour',
        refId: 'non-existent',
        element: 'weather',
        valueCode: null,
        valueText: '雪',
        valueNumber: null,
        unit: null,
        sequence: 99,
      },
    ],
  };
  const droppedModel = buildAreaForecastModel(droppedDto);
  assert.equal(droppedModel.kind, 'table');
  if (droppedModel.kind === 'table') {
    assert.equal(droppedModel.droppedValueCount, 1);
  }

  // 同一 refId・同一 element の重複値は missing になる
  const duplicateDto: AreaTimeseriesData = {
    ...base,
    values: [
      ...base.values,
      {
        blockId: 'region-3hour',
        refId: '1',
        element: 'weather',
        valueCode: null,
        valueText: '雨',
        valueNumber: null,
        unit: null,
        sequence: 99,
      },
    ],
  };
  const dupModel = buildAreaForecastModel(duplicateDto);
  assert.equal(dupModel.kind, 'table');
  if (dupModel.kind === 'table') {
    const weather = dupModel.intervals[0]!;
    if (weather.kind === 'value') {
      assert.equal(weather.weather.kind, 'missing');
    }
  }

  // 区間の重なり・逆転 -> invalid
  const invalidOverlapDto: AreaTimeseriesData = {
    ...base,
    timeDefines: [
      {
        blockId: 'region-3hour',
        timeId: '1',
        sequence: 1,
        timeFrom: '2026-09-28T00:00:00Z',
        timeTo: '2026-09-28T06:00:00Z',
        duration: 'PT6H',
      },
      {
        blockId: 'region-3hour',
        timeId: '2',
        sequence: 2,
        timeFrom: '2026-09-28T03:00:00Z', // 00:00〜06:00 と重複
        timeTo: '2026-09-28T09:00:00Z',
        duration: 'PT6H',
      },
    ],
  };
  assert.equal(buildAreaForecastModel(invalidOverlapDto).kind, 'invalid');

  const invalidReversedDto: AreaTimeseriesData = {
    ...base,
    timeDefines: [
      {
        blockId: 'region-3hour',
        timeId: '1',
        sequence: 1,
        timeFrom: '2026-09-28T06:00:00Z',
        timeTo: '2026-09-28T03:00:00Z', // timeTo <= timeFrom
        duration: 'PT3H',
      },
    ],
  };
  assert.equal(buildAreaForecastModel(invalidReversedDto).kind, 'invalid');
});

test('Issue #58 AC-3: 14区間・15時点の生成と区間「6-9時」…「21-24時」、時点「6時」…「0時」', () => {
  // 23日 06:00 JST 起点、14区間 (PT3H)、15時点 (最後の25日00:00 JSTは区間なし)
  const timeDefines = [];
  const baseMs = Date.parse('2026-09-22T21:00:00Z'); // 23日 06:00 JST
  for (let i = 0; i < 14; i++) {
    const from = new Date(baseMs + i * 3 * 3600 * 1000).toISOString();
    const to = new Date(baseMs + (i + 1) * 3 * 3600 * 1000).toISOString();
    timeDefines.push({
      blockId: 'region-3hour',
      timeId: `r-${i}`,
      sequence: i + 1,
      timeFrom: from,
      timeTo: to,
      duration: 'PT3H',
    });
  }
  for (let i = 0; i < 15; i++) {
    const from = new Date(baseMs + i * 3 * 3600 * 1000).toISOString();
    timeDefines.push({
      blockId: 'temperature-3hour',
      timeId: `t-${i}`,
      sequence: i + 1,
      timeFrom: from,
      timeTo: from,
      duration: null,
    });
  }

  const dto: AreaTimeseriesData = {
    station: { code: '44132', name: '東京' },
    timeDefines,
    values: [],
  };

  const model = buildAreaForecastModel(dto);
  assert.equal(model.kind, 'table');
  if (model.kind !== 'table') return;

  assert.equal(model.columns.length, 15);
  // 先頭列 (23日06:00 JST)
  assert.equal(model.columns[0]!.intervalLabel, '6-9時');
  assert.equal(model.columns[0]!.pointLabel, '6時');
  // 6番目 (24日00:00 JST終端の列: 23日21-24時)
  assert.equal(model.columns[5]!.intervalLabel, '21-24時');
  assert.equal(model.columns[5]!.pointLabel, '21時');
  // 最終列 (25日00:00 JST)
  assert.equal(model.columns[14]!.intervalLabel, null);
  assert.equal(model.columns[14]!.pointLabel, '0時');
});

test('Issue #58 AC-4: パネル3列の単体テスト (現在区間起点・境界now=timeTo・未来先頭・3列未満・過去のみ)', () => {
  const base = sampleDto();
  const model = buildAreaForecastModel(base);
  assert.equal(model.kind, 'table');
  if (model.kind !== 'table') return;

  // 1. 現在区間内: 2026-09-28T01:00:00Z (10:00 JST) -> 9-12時区間内
  const cols1 = selectPanelColumns(
    model.columns,
    model.intervals,
    Date.parse('2026-09-28T01:00:00Z'),
  );
  assert.equal(cols1.length, 3);
  assert.equal(cols1[0]!.at, '2026-09-28T00:00:00Z'); // 9時列起点

  // 2. 境界 now = timeTo: 2026-09-28T03:00:00Z (12:00 JST) -> 次の12-15時区間に属する
  const cols2 = selectPanelColumns(
    model.columns,
    model.intervals,
    Date.parse('2026-09-28T03:00:00Z'),
  );
  assert.equal(cols2.length, 2); // 12時, 15時の2列
  assert.equal(cols2[0]!.at, '2026-09-28T03:00:00Z');

  // 3. 現在区間なしで未来の先頭から: 2026-09-27T00:00:00Z (開始前)
  const cols3 = selectPanelColumns(
    model.columns,
    model.intervals,
    Date.parse('2026-09-27T00:00:00Z'),
  );
  assert.equal(cols3.length, 3);
  assert.equal(cols3[0]!.at, '2026-09-28T00:00:00Z');

  // 4. 過去だけの保持値で「表示できる時間帯はありません」 (空配列)
  const cols4 = selectPanelColumns(
    model.columns,
    model.intervals,
    Date.parse('2026-09-29T00:00:00Z'),
  );
  assert.equal(cols4.length, 0);
});

test('Issue #59 AC-5: 天気アイコン対応表の単体テスト', () => {
  // 晴れ→sunny、くもり→cloud、雨→rainy、雪→weather_snowy、雨または雪/雨か雪/雪か雨→rainy_snow
  assert.equal(buildWeatherView('晴れ').icon, 'sunny');
  assert.equal(buildWeatherView('くもり').icon, 'cloud');
  assert.equal(buildWeatherView('雨').icon, 'rainy');
  assert.equal(buildWeatherView('雪').icon, 'weather_snowy');
  assert.equal(buildWeatherView('雨または雪').icon, 'rainy_snow');
  assert.equal(buildWeatherView('雨か雪').icon, 'rainy_snow');
  assert.equal(buildWeatherView('雪か雨').icon, 'rainy_snow');

  // 空文字・表にない文字・前後空白付きは icon: null で原文表示
  assert.deepEqual(buildWeatherView(''), { kind: 'text', text: '', icon: null });
  assert.deepEqual(buildWeatherView('くもり一時雨'), {
    kind: 'text',
    text: 'くもり一時雨',
    icon: null,
  });
  assert.deepEqual(buildWeatherView('晴れ '), { kind: 'text', text: '晴れ ', icon: null });

  // null は missing
  assert.deepEqual(buildWeatherView(null), { kind: 'missing' });
});

test('Issue #58 AC-6: 風速・風向・気温の単体テスト', () => {
  // 風速 '1'〜'6'
  const r1 = buildLevelView('1');
  assert.equal(r1.kind, 'known');
  if (r1.kind === 'known') {
    assert.equal(r1.rangeLabel, '0-2');
    assert.equal(r1.colorVar, 'var(--wx-data-nowcast-1)');
  }

  const r6 = buildLevelView('6');
  assert.equal(r6.kind, 'known');
  if (r6.kind === 'known') {
    assert.equal(r6.rangeLabel, '20以上');
    assert.equal(r6.colorVar, 'var(--wx-data-nowcast-7)');
  }

  // unknown
  for (const raw of ['0', '7', '4.0', '４']) {
    const unk = buildLevelView(raw);
    assert.equal(unk.kind, 'unknown');
    if (unk.kind === 'unknown') {
      assert.equal(unk.raw, raw);
    }
  }

  // null は missing
  assert.equal(buildLevelView(null).kind, 'missing');

  // 気温
  assert.deepEqual(buildTemperatureView(12, null, '度'), { kind: 'value', text: '12℃' });
  assert.deepEqual(buildTemperatureView(-3, null, '度'), { kind: 'value', text: '-3℃' });
  assert.deepEqual(buildTemperatureView(null, '約15度', null), { kind: 'value', text: '約15度' });
  assert.deepEqual(buildTemperatureView(null, null, null), { kind: 'missing' });
});

test('Issue #58 AC-9: aria-label 生成ヘルパー', () => {
  const base = sampleDto();
  const model = buildAreaForecastModel(base);
  assert.equal(model.kind, 'table');
  if (model.kind !== 'table') return;

  const col0 = model.columns[0]!;
  const int0 = model.intervals[0]!;
  const pt0 = model.points[0]!;

  // 天気 aria-label
  assert.equal(formatWeatherAriaLabel(int0, col0), '2026年9月28日(月) 9時から12時、くもり');

  // 風 aria-label
  assert.equal(
    formatWindAriaLabel(int0, col0),
    '2026年9月28日(月) 9時から12時、北西の風、毎秒3から5メートル',
  );

  // 気温 aria-label
  assert.equal(formatTemperatureAriaLabel(pt0, col0), '2026年9月28日(月) 9時、気温12度');

  // 負値の気温
  const col1 = model.columns[1]!;
  const pt1 = model.points[1]!;
  assert.equal(formatTemperatureAriaLabel(pt1, col1), '2026年9月28日(月) 12時、気温マイナス3度');

  // 欠測
  const missingInt = { ...int0, weather: { kind: 'missing' as const } };
  assert.equal(formatWeatherAriaLabel(missingInt, col0), '2026年9月28日(月) 9時から12時、天気欠測');

  // 対象外
  const noneInt = { kind: 'none' as const, startIndex: 2, span: 1 };
  assert.equal(formatWeatherAriaLabel(noneInt, model.columns[2]!), '2026年9月28日(月)、対象外');
});

test('Issue #58 AC-12: resolveAreaForecastTargets - 想定値で固定表記、不一致でAPI名称', () => {
  // 想定値 (130010, 44132)
  const defaultTargets = resolveAreaForecastTargets(
    { code: '130010', name: '東京都' },
    { code: '44132', name: '東京管区気象台' },
  );
  assert.equal(defaultTargets.weatherWindTarget, '天気・風：東京地方');
  assert.equal(defaultTargets.temperatureTarget, '気温：東京（北の丸公園）');
  assert.equal(defaultTargets.detailDialogTarget, '東京地方／東京（北の丸公園）');

  // 不一致 (別地点)
  const otherTargets = resolveAreaForecastTargets(
    { code: '140010', name: '神奈川県東部' },
    { code: '46106', name: '横浜' },
  );
  assert.equal(otherTargets.weatherWindTarget, '天気・風：神奈川県東部');
  assert.equal(otherTargets.temperatureTarget, '気温：横浜');
  assert.equal(otherTargets.detailDialogTarget, '神奈川県東部／横浜');
});
