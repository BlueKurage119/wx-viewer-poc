import './setupEnv.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TRAINING_ITEMS, type TrainingTelegramPreview } from '@wx-viewer-poc/shared';
import { views } from '../src/shell/config.ts';
import { TrainingContent } from '../src/training/TrainingView.tsx';
import { formatTrainingJst } from '../src/training/trainingFormat.ts';
import { INITIAL_TRAINING_STATE, type TrainingState } from '../src/training/trainingController.ts';
(globalThis as unknown as { React: typeof React }).React = React;

const ready: TrainingState = {
  load: 'ready',
  items: TRAINING_ITEMS,
  targetLabel: '東京ビッグサイト周辺',
  selected: [],
  generation: { phase: 'idle' },
};

const preview: TrainingTelegramPreview = {
  id: 'g:0',
  itemIds: ['bulletin-tornado'],
  telegramType: 'VPHW50',
  title: '東京都気象防災速報（竜巻注意）',
  xml: '<?xml version="1.0"?>\n<Report><Text>a&amp;b</Text></Report>\n',
  reportDateTime: '2026-10-11T05:10:00.000Z',
  targetDateTime: '2026-10-11T05:10:00.000Z',
  validDateTime: '2026-10-11T06:10:00.000Z',
  areaNames: ['東京都', '東京地方', '２３区東部', '江東区'],
  provenance: 'synthetic',
  isTraining: true,
};

const render = (state: TrainingState) =>
  renderToStaticMarkup(
    React.createElement(TrainingContent, {
      state,
      onSelect: () => {},
      onGenerate: () => {},
      onReload: () => {},
    }),
  );

test('読込中・読込失敗（再読込あり）', () => {
  assert.match(render(INITIAL_TRAINING_STATE), /role="status"/);
  const failed = render({ ...ready, load: 'failed' });
  assert.match(failed, /項目を取得できませんでした/);
  assert.match(failed, /再読込/);
});

test('項目: 現象ごとのfieldset、同一現象はradio(選択なし付き)、単独項目はcheckbox、選択不可は理由つきdisabled', () => {
  const html = render(ready);
  assert.match(html, /東京ビッグサイト周辺/);
  assert.equal((html.match(/<fieldset/g) ?? []).length, 18);
  // 大雨はradio: 選択なし + 4段階
  const rain = html.match(/<legend>大雨<\/legend>(.*?)<\/fieldset>/)![1]!;
  assert.equal((rain.match(/type="radio"/g) ?? []).length, 5);
  assert.match(rain, /選択なし/);
  assert.ok(!rain.includes('type="checkbox"'));
  // 雷は単独checkbox
  const thunder = html.match(/<legend>雷<\/legend>(.*?)<\/fieldset>/)![1]!;
  assert.match(thunder, /type="checkbox"/);
  assert.ok(!thunder.includes('type="radio"'));
  // 土砂災害のL3-L5は理由つきdisabled、L2は選択可
  const landslide = html.match(/<legend>土砂災害<\/legend>(.*?)<\/fieldset>/)![1]!;
  assert.equal((landslide.match(/disabled=""/g) ?? []).length, 3);
  assert.match(landslide, /江東区の該当基準設定がないため選択できません/);
  // 融雪・なだれは選択不可のみ
  for (const legend of ['融雪', 'なだれ']) {
    const group = html.match(new RegExp(`<legend>${legend}</legend>(.*?)</fieldset>`))![1]!;
    assert.match(group, /disabled=""/);
    assert.match(group, /選択できません/);
  }
  // 風は同じfieldsetに暴風と暴風雪（同時選択不可の同一group）
  const wind = html.match(/<legend>風<\/legend>(.*?)<\/fieldset>/)![1]!;
  assert.match(wind, /暴風警報/);
  assert.match(wind, /暴風雪警報/);
  // 日時・区域入力、注入・取消・解除操作は置かない
  assert.ok(!/type="(text|datetime-local|date|time)"/.test(html));
  for (const word of ['注入', '取消', '解除', '抹消']) assert.ok(!html.includes(word), word);
});

test('生成ボタン: 未選択・送信中はdisabled、失敗後は再実行、選択状態を反映', () => {
  assert.match(render(ready), /<md-gb-button[^>]*disabled=""[^>]*>生成</);
  const selected = render({ ...ready, selected: ['warning-43'] });
  assert.ok(!/<md-gb-button[^>]*disabled=""[^>]*>生成</.test(selected));
  assert.match(selected, /<input[^>]*checked=""[^>]*\/><span>レベル４大雨危険警報<\/span>/);
  const sending = render({ ...ready, selected: ['warning-43'], generation: { phase: 'sending' } });
  assert.match(sending, /生成中/);
  assert.match(sending, /<md-gb-button[^>]*disabled=""[^>]*>生成</);
  assert.match(sending, /<fieldset[^>]*disabled=""/);
  const failed = render({
    ...ready,
    selected: ['warning-43'],
    generation: { phase: 'failed', message: '電文の生成に失敗しました（500）' },
  });
  assert.match(failed, /role="alert"[^>]*>電文の生成に失敗しました（500）/);
  assert.match(failed, />再実行</);
  assert.ok(!/<md-gb-button[^>]*disabled=""[^>]*>再実行</.test(failed));
});

test('結果: 訓練用合成バッジ・区域・JST時刻・失効・XMLテキスト(details/pre)', () => {
  const html = render({
    ...ready,
    selected: ['bulletin-tornado'],
    generation: {
      phase: 'done',
      result: { generationId: 'g', generatedAt: '2026-10-11T05:10:30.000Z', telegrams: [preview] },
    },
  });
  assert.match(html, /訓練用合成/);
  assert.match(html, /東京都気象防災速報（竜巻注意）/);
  assert.match(html, /東京都／東京地方／２３区東部／江東区/);
  assert.match(html, /2026\/10\/11 14:10/);
  assert.match(html, /2026\/10\/11 15:10/);
  assert.match(html, /竜巻注意/);
  assert.match(
    html,
    /<details><summary>XML<\/summary><pre>&lt;\?xml version=&quot;1\.0&quot;\?&gt;/,
  );
  assert.ok(!html.includes('<Report>'), 'XMLは文字列としてエスケープされる');
  assert.ok(!html.includes('TRC'), '端末の会場名を結果へ出さない');
});

test('JST整形: 日付跨ぎ・年末', () => {
  assert.equal(formatTrainingJst('2026-12-31T15:00:00.000Z'), '2027/01/01 00:00');
  assert.equal(formatTrainingJst('2026-10-11T14:59:00.000Z'), '2026/10/11 23:59');
  assert.equal(formatTrainingJst('bad'), 'bad');
});

test('H端末のナビに訓練を表示しない（K端末のみ）', () => {
  const training = views.find((view) => view.id === 'training')!;
  assert.deepEqual([...training.modes], ['K']);
});

test('XMLの描画にdangerouslySetInnerHTMLを使わず、色はトークンのみ', () => {
  const view = readFileSync(new URL('../src/training/TrainingView.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/training/training.css', import.meta.url), 'utf8');
  assert.ok(!view.includes('dangerouslySetInnerHTML'));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'HEX直書き禁止');
  assert.ok(!/\brgba?\(|\bhsla?\(/.test(css), 'RGB直書き禁止');
  assert.ok(!/<md-/.test(view), '生のmd-*タグ禁止');
});
