import './setupEnv.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TRAINING_ITEMS, type TrainingTelegramPreview } from '@wx-viewer-poc/shared';
import { views } from '../src/shell/config.ts';
import { AppShell } from '../src/shell/AppShell.tsx';
import { TrainingContent } from '../src/training/TrainingView.tsx';
import { TrainingToolbar } from '../src/training/TrainingToolbar.tsx';
import { TrainingXmlDialog } from '../src/training/TrainingXmlDialog.tsx';
import { formatTrainingJst, formatTrainingJstTime } from '../src/training/trainingFormat.ts';
import {
  INITIAL_TRAINING_STATE,
  type TrainingHistoryEntry,
  type TrainingState,
} from '../src/training/trainingController.ts';
import { testTerminals } from './venueConfigPreload.ts';
(globalThis as unknown as { React: typeof React }).React = React;

const ready: TrainingState = {
  load: 'ready',
  items: TRAINING_ITEMS,
  selected: [],
  generation: { phase: 'idle' },
  history: [],
  selectedEntryId: null,
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

const entry = (id: string, labels: string[], type = 'VPHW50'): TrainingHistoryEntry => ({
  id,
  generatedAt: '2026-10-11T06:12:04.000Z',
  itemLabels: labels,
  telegram: { ...preview, id, telegramType: type as never },
});

const render = (state: TrainingState) =>
  renderToStaticMarkup(
    React.createElement(TrainingContent, {
      state,
      onSelect: () => {},
      onGenerate: () => {},
      onReset: () => {},
      onReload: () => {},
      onOpenEntry: () => {},
    }),
  );

function generateButton(html: string): string {
  return html.match(/<md-gb-button[^>]*>生成<\/md-gb-button>/)![0];
}
function resetButton(html: string): string {
  return html.match(/<md-gb-button[^>]*>リセット<\/md-gb-button>/)![0];
}

test('読込中・読込失敗は左ペイン内に出し、右ペインは描画したまま', () => {
  const loading = render(INITIAL_TRAINING_STATE);
  assert.match(loading, /role="status"/);
  assert.match(loading, /0／20件/);
  assert.match(loading, /リセット/);
  const failed = render({ ...ready, load: 'failed', items: [] });
  assert.match(failed, /項目を取得できませんでした/);
  assert.match(failed, /再読込/);
  assert.match(failed, /0／20件/);
});

test('項目: 1行1カテゴリ(16行)、同一現象はradio(なし付き)、単独項目はcheckbox。枠や説明文は付けない', () => {
  const html = render(ready);
  assert.ok(!html.includes('東京ビッグサイト周辺'));
  assert.equal((html.match(/role="group"/g) ?? []).length, 16);
  assert.ok(!html.includes('<fieldset') && !html.includes('<legend'));
  const row = (label: string) =>
    html.match(new RegExp(`training-category-name">${label}</span>(.*?)</div></div>`))![1]!;
  const rain = row('大雨');
  assert.equal((rain.match(/type="radio"/g) ?? []).length, 5);
  assert.match(rain, /<span>なし<\/span>/);
  assert.ok(!html.includes('選択なし'));
  const thunder = row('雷');
  assert.match(thunder, /type="checkbox"/);
  // 土砂災害はL2だけなのでcheckbox
  const landslide = row('土砂災害');
  assert.match(landslide, /type="checkbox"/);
  assert.match(landslide, /レベル２土砂災害注意報/);
  assert.ok(!html.includes('レベル３土砂災害警報'));
  assert.ok(!/<input[^>]*disabled/.test(html));
  for (const word of ['融雪', 'なだれ', '選択できません']) {
    assert.ok(!html.includes(word), word);
  }
  const wind = row('風');
  assert.match(wind, /暴風警報/);
  assert.match(wind, /暴風雪警報/);
  assert.ok(!/type="(text|datetime-local|date|time)"/.test(html));
  for (const word of ['注入', '取消', '解除', '抹消']) assert.ok(!html.includes(word), word);
});

test('左ペイン下端の「生成」(塗りつぶし)・「リセット」(文字だけ)はsoftDisabledで押下可否を示す', () => {
  const none = render(ready);
  assert.match(generateButton(none), /color="filled"/);
  assert.match(resetButton(none), /color="text"/);
  assert.match(generateButton(none), /soft-disabled=""/);
  assert.match(resetButton(none), /soft-disabled=""/);
  assert.ok(!/<md-gb-button[^>]*[^-]disabled=""/.test(none), '本物のdisabledは使わない');
  const selected = render({ ...ready, selected: ['warning-43'] });
  assert.ok(!/soft-disabled/.test(generateButton(selected)));
  assert.ok(!/soft-disabled/.test(resetButton(selected)));
  assert.match(selected, /<input[^>]*checked=""[^>]*\/><span>レベル４大雨危険警報<\/span>/);
  const loading = render({ ...INITIAL_TRAINING_STATE, selected: ['warning-43'] });
  assert.match(generateButton(loading), /soft-disabled=""/);
  // 操作行は項目領域の外（下端固定）に出る
  assert.ok(none.indexOf('training-actions') > none.indexOf('training-items'));
  assert.ok(none.indexOf('training-actions') < none.indexOf('training-right'));
});

test('生成中: 状態行に「生成中」、全input・生成・リセットは押せず、一覧は維持', () => {
  const html = render({
    ...ready,
    selected: ['warning-43'],
    generation: { phase: 'sending' },
    history: [entry('a', ['雷注意報'], 'VPWW61')],
    selectedEntryId: 'a',
  });
  const status = html.match(/class="training-statusbar">(.*?)<\/div>/)![1]!;
  assert.match(status, /1／20件/);
  assert.match(status, /生成中/);
  assert.ok((html.match(/<input[^>]*disabled=""/g) ?? []).length > 30);
  assert.ok(!/<input(?![^>]*disabled)/.test(html), '全inputが操作不可');
  assert.match(generateButton(html), /soft-disabled=""/);
  assert.match(resetButton(html), /soft-disabled=""/);
  assert.match(html, /雷注意報/);
});

test('失敗: 状態行に日本語エラー(alert)、ラベルは「生成」のまま、選択と一覧は維持', () => {
  const html = render({
    ...ready,
    selected: ['warning-43'],
    generation: { phase: 'failed', message: '訓練電文を生成できませんでした。' },
    history: [entry('a', ['雷注意報'], 'VPWW61')],
  });
  assert.match(html, /role="alert"[^>]*>訓練電文を生成できませんでした。/);
  assert.ok(!html.includes('再実行'));
  assert.ok(!/soft-disabled/.test(generateButton(html)));
  assert.match(html, /1／20件/);
  assert.match(html, /checked=""/);
});

test('一覧: 空は「0／20件」だけ、行は時刻(JST)・項目名・電文種別コード、選択行はaria-selected', () => {
  const empty = render(ready);
  assert.match(empty, /0／20件/);
  assert.match(empty, /<ul[^>]*role="listbox"[^>]*><\/ul>/);
  const html = render({
    ...ready,
    history: [
      entry('a', ['雷注意報', '乾燥注意報'], 'VPWW61'),
      entry('b', ['レベル３大雨警報'], 'VPWW55'),
    ],
    selectedEntryId: 'a',
  });
  assert.match(html, /2／20件/);
  assert.match(
    html,
    /<li[^>]*aria-selected="true"[^>]*><span class="training-row-time">15:12:04<\/span><span class="training-row-items">雷注意報、乾燥注意報<\/span><span class="training-row-type">VPWW61<\/span><\/li>/,
  );
  assert.match(html, /<li[^>]*aria-selected="false"[^>]*>.*?レベル３大雨警報.*?VPWW55/);
  assert.equal((html.match(/role="option"/g) ?? []).length, 2);
  assert.ok(html.indexOf('VPWW61') < html.indexOf('VPWW55'), '渡された順（新しい順）に描画する');
  assert.ok(!html.includes('<details'), '一覧にXMLは展開しない');
});

test('XMLダイアログ: 見出し・訓練用合成・区域・発表/失効(JST)・項目名・XML全文(エスケープ)、閉じるボタン', () => {
  const html = renderToStaticMarkup(
    React.createElement(TrainingXmlDialog, {
      entry: entry('a', ['竜巻注意']),
      onClose: () => {},
    }),
  );
  assert.match(
    html,
    /^<dialog[^>]*class="monitoring-dialog monitoring-dialog-wide training-dialog"/,
  );
  assert.match(html, /aria-labelledby="training-dialog-title"/);
  assert.match(html, /id="training-dialog-title"[^>]*>東京都気象防災速報（竜巻注意）<\/h2>/);
  assert.match(html, /訓練用合成/);
  assert.match(html, /東京都／東京地方／２３区東部／江東区/);
  assert.match(html, /2026\/10\/11 14:10/);
  assert.match(html, /2026\/10\/11 15:10/);
  assert.match(html, /竜巻注意/);
  assert.match(html, /<pre[^>]*>&lt;\?xml version=&quot;1\.0&quot;\?&gt;/);
  assert.ok(!html.includes('<Report>'));
  assert.match(html, />閉じる<\/md-gb-button>/);
  const closed = renderToStaticMarkup(
    React.createElement(TrainingXmlDialog, { entry: null, onClose: () => {} }),
  );
  assert.ok(!closed.includes('<h2'));
});

test('ツールバーは空の .monitoring-toolbar だけ。training画面は監視と同じ外枠classを持つ', () => {
  assert.equal(
    renderToStaticMarkup(React.createElement(TrainingToolbar)),
    '<div class="monitoring-toolbar"></div>',
  );
  const terminal = testTerminals.find((t) => t.mode === 'K')!;
  const shell = (view: 'training' | 'monitor' | 'warnings') =>
    renderToStaticMarkup(
      React.createElement(
        AppShell,
        {
          terminal,
          title: 't',
          view,
          onViewChange: () => undefined,
          navigation: views.filter((item) => item.modes.includes(terminal.mode)),
          now: new Date('2026-10-12T00:00:00.000Z'),
          connection: { failed: false, lastSuccessAt: null },
          notifications: React.createElement('div'),
          toolbar: React.createElement(TrainingToolbar),
        },
        React.createElement('div'),
      ),
    );
  assert.match(
    shell('training'),
    /class="view-toolbar view-toolbar-monitor"[^>]*aria-label="画面操作"/,
  );
  assert.match(shell('monitor'), /class="view-toolbar view-toolbar-monitor"/);
  assert.ok(!/view-toolbar-monitor/.test(shell('warnings')));
});

test('JST整形: 日付跨ぎ・年末・時刻', () => {
  assert.equal(formatTrainingJst('2026-12-31T15:00:00.000Z'), '2027/01/01 00:00');
  assert.equal(formatTrainingJst('bad'), 'bad');
  assert.equal(formatTrainingJstTime('2026-10-11T14:59:09.000Z'), '23:59:09');
  assert.equal(formatTrainingJstTime('2026-12-31T15:00:01.000Z'), '00:00:01');
});

test('H端末のナビに訓練を表示しない（K端末のみ）', () => {
  assert.deepEqual([...views.find((view) => view.id === 'training')!.modes], ['K']);
});

test('XMLの描画にdangerouslySetInnerHTMLを使わず、色はトークンのみ、生のmd-*タグ禁止', () => {
  const read = (name: string) =>
    readFileSync(new URL(`../src/training/${name}`, import.meta.url), 'utf8');
  const css = read('training.css');
  for (const name of ['TrainingView.tsx', 'TrainingXmlDialog.tsx', 'TrainingToolbar.tsx']) {
    assert.ok(!read(name).includes('dangerouslySetInnerHTML'), name);
    assert.ok(!/<md-/.test(read(name)), name);
    assert.ok(!/(localStorage|sessionStorage|indexedDB)/.test(read(name)), name);
  }
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'HEX直書き禁止');
  assert.ok(!/\brgba?\(|\bhsla?\(/.test(css), 'RGB直書き禁止');
  assert.match(css, /grid-template-columns: 6em minmax\(0, 1fr\)/);
  assert.match(css, /grid-template-columns: minmax\(320px, 2fr\) minmax\(0, 3fr\)/);
  assert.match(css, /grid-template-rows: 48px minmax\(0, 1fr\)/);
  assert.match(css, /max-block-size: 336px/);
});
