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
import type { TrainingToolbarModel } from '../src/training/useTrainingScreen.ts';
import {
  isTrainingSendReady,
  trainingToolbarDefinitions,
  type TrainingToolbarSelection,
} from '../src/training/trainingToolbarState.ts';
import { TrainingXmlDialog } from '../src/training/TrainingXmlDialog.tsx';
import { formatTrainingJst, formatTrainingJstTime } from '../src/training/trainingFormat.ts';
import { INITIAL_TRAINING_STATE, type TrainingState } from '../src/training/trainingController.ts';
import type { TrainingStockEntry } from '../src/training/trainingStock.ts';
import { testTerminals } from './venueConfigPreload.ts';
(globalThis as unknown as { React: typeof React }).React = React;

const ready: TrainingState = {
  load: 'ready',
  items: TRAINING_ITEMS,
  selected: [],
  generation: { phase: 'idle' },
  history: [],
  checked: [],
  saveFailed: false,
  injecting: false,
  injected: [],
  injectedLoadFailed: false,
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

const entry = (id: string, labels: string[], type = 'VPHW50'): TrainingStockEntry => ({
  id,
  generatedAt: '2026-10-11T06:12:04.000Z',
  itemLabels: labels,
  telegram: { ...preview, id, telegramType: type as never },
  injectionStatus: 'pending',
});

const TID_1 = '11111111-1111-4111-8111-111111111111';
const TID_2 = '22222222-2222-4222-8222-222222222222';
const injection = (
  trainingId: string,
  acceptedAt: string,
  telegrams: readonly (readonly [string | null, string])[],
) => ({
  trainingId,
  terminalId: 'kkeagh02',
  acceptedAt,
  telegrams: telegrams.map(([title, telegramType], i) => ({
    sequence: i + 1,
    telegramType: telegramType as never,
    title,
    previewId: `p${i}:0`,
  })),
});

const render = (state: TrainingState) =>
  renderToStaticMarkup(
    React.createElement(TrainingContent, {
      state,
      onSelect: () => {},
      onGenerate: () => {},
      onReset: () => {},
      onReload: () => {},
      onSetChecked: () => {},
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

test('項目: 1行1カテゴリ(10行)、「その他」は7checkbox1行、同一現象はradio(なし付き)。枠や説明文は付けない', () => {
  const html = render(ready);
  assert.ok(!html.includes('東京ビッグサイト周辺'));
  assert.equal((html.match(/role="group"/g) ?? []).length, 10);
  assert.ok(!html.includes('<fieldset') && !html.includes('<legend'));
  const row = (label: string) =>
    html
      .split('<div class="training-category"')
      .find((chunk) => chunk.includes(`training-category-name">${label}</span>`))!;
  // 「その他」: 雷・濃霧・乾燥・低温・霜・着氷・着雪の7checkboxが1行に並ぶ（別行にしない）
  const other = row('その他');
  assert.equal((other.match(/type="checkbox"/g) ?? []).length, 7);
  assert.ok(!other.includes('type="radio"'));
  for (const label of [
    '雷注意報',
    '濃霧注意報',
    '乾燥注意報',
    '低温注意報',
    '霜注意報',
    '着氷注意報',
    '着雪注意報',
  ]) {
    assert.ok(other.includes(`<span>${label}</span>`), label);
  }
  for (const separate of ['雷', '濃霧', '乾燥', '低温', '霜', '着氷', '着雪']) {
    assert.ok(!html.includes(`training-category-name">${separate}</span>`), separate);
  }
  const rain = row('大雨');
  assert.equal((rain.match(/type="radio"/g) ?? []).length, 5);
  assert.match(rain, /<span>なし<\/span>/);
  assert.ok(!html.includes('選択なし'));
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
  });
  const status = html.match(/class="training-statusbar">(.*?)<\/div>/)![1]!;
  assert.match(status, /1／20件/);
  assert.match(status, /生成中/);
  assert.ok((html.match(/<input[^>]*disabled=""/g) ?? []).length > 30);
  const left = html.slice(0, html.indexOf('training-right'));
  assert.ok(!/<input(?![^>]*disabled)/.test(left), '左ペインの全inputが操作不可');
  const right = html.slice(html.indexOf('training-right'));
  assert.ok(!/<input[^>]*disabled/.test(right), '一覧のチェックは生成中も操作できる（削除のため）');
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

test('一覧: 空は「0／20件」だけ、行はチェック欄＋行ボタン(時刻JST・項目名・種別)で、強調属性を付けない', () => {
  const empty = render(ready);
  assert.match(empty, /0／20件/);
  assert.match(empty, /<ul[^>]*aria-label="生成した電文の一覧"[^>]*><\/ul>/);
  const html = render({
    ...ready,
    history: [
      entry('a', ['雷注意報', '乾燥注意報'], 'VPWW61'),
      entry('b', ['レベル３大雨警報'], 'VPWW55'),
    ],
    checked: ['b'],
  });
  assert.match(html, /2／20件/);
  assert.match(
    html,
    /<li class="training-row" data-entry-id="a"><input type="checkbox" class="training-row-check" aria-label="15:12:04 VPWW61 を選択"\/><button type="button" class="training-row-open"><span class="training-row-time">15:12:04<\/span><span class="training-row-items">雷注意報、乾燥注意報<\/span><span class="training-row-type">VPWW61<\/span><span class="training-row-status" data-status="pending">未投入<\/span><\/button><\/li>/,
  );
  // チェック欄とボタンは入れ子にせず、チェック状態だけが反映される
  assert.match(
    html,
    /data-entry-id="b"><input[^>]*aria-label="15:12:04 VPWW55 を選択"[^>]*checked=""/,
  );
  assert.equal((html.match(/<li[^>]*><input[^>]*checked=""/g) ?? []).length, 1);
  assert.ok(!html.includes('aria-current'), '生成直後の強調はしない');
  assert.ok(!/<button[^>]*>(?:(?!<\/button>).)*<input/.test(html));
  assert.ok(html.indexOf('VPWW61') < html.indexOf('VPWW55'), '渡された順（新しい順）に描画する');
  assert.ok(!html.includes('<details'), '一覧にXMLは展開しない');
});

test('保存失敗: 状態行に「一覧を保存できませんでした」。生成失敗があればそちらを優先', () => {
  const saveFailed = render({ ...ready, saveFailed: true });
  assert.match(saveFailed, /role="alert"[^>]*>一覧を保存できませんでした/);
  const both = render({
    ...ready,
    saveFailed: true,
    generation: { phase: 'failed', message: '訓練電文を生成できませんでした。' },
  });
  assert.match(both, /訓練電文を生成できませんでした。/);
  assert.ok(!both.includes('一覧を保存できませんでした'));
  assert.ok(!render(ready).includes('保存できませんでした'));
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

function toolbarModel(
  overrides: Partial<TrainingToolbarModel> & {
    selection?: TrainingToolbarSelection | null;
    counts?: { checked: number; stock: number };
    history?: string[];
  } = {},
): TrainingToolbarModel {
  const selection = overrides.selection ?? null;
  const counts = overrides.counts ?? { checked: 0, stock: 0 };
  const noop = () => undefined;
  return {
    navigation: {
      localState: {
        history: overrides.history ?? ['training-root'],
        selectedOperation: selection,
        openDialog: null,
      },
      setLocalState: noop,
      currentToolbar: trainingToolbarDefinitions[0]!,
      definitions: trainingToolbarDefinitions,
      clearSelection: noop,
      navigate: noop,
      back: noop,
      backToRoot: noop,
    } as never,
    counts,
    selection,
    sendReady: isTrainingSendReady(selection, counts),
    selectOperation: noop,
    clear: noop,
    send: noop,
  };
}
const renderToolbar = (model: TrainingToolbarModel) =>
  renderToStaticMarkup(React.createElement(TrainingToolbar, { model }));
const button = (html: string, label: string) =>
  html
    .split('<md-gb-button')
    .find((chunk) => chunk.includes(`monitoring-toolbar-button-content">${label}</span>`))!;

test('ツールバー: 左に<<・<(ルートでdisabled・階層名なし)、中央に電文投入・リスト消去・リスト全消(文字だけ)、右にクリア・送信(アイコン付き)', () => {
  const html = renderToolbar(toolbarModel());
  assert.match(
    html,
    /^<div class="monitoring-toolbar"><div class="monitoring-toolbar-group monitoring-toolbar-navigation" role="group" aria-label="訓練メニュー移動">/,
  );
  const icons = [...html.matchAll(/<md-gb-icon-button\b([^>]*)>/g)].map((m) => m[1]!);
  assert.equal(icons.length, 2);
  assert.ok(icons.every((attributes) => /disabled=""/.test(attributes)));
  assert.ok(!html.includes('monitoring-toolbar-title'));
  const scroll = html.match(
    /class="monitoring-toolbar-scroll">(.*?)<div class="monitoring-toolbar-group monitoring-toolbar-submit">/,
  )![1]!;
  assert.equal((scroll.match(/<md-gb-button/g) ?? []).length, 3);
  assert.ok(scroll.indexOf('>リスト全消<') < scroll.indexOf('>電文投入<'));
  assert.ok(scroll.indexOf('>リスト消去<') < scroll.indexOf('>リスト全消<'));
  assert.ok(!scroll.includes('monitoring-toolbar-icon'), '項目ボタンは文字だけ');
  const submit = html.slice(html.indexOf('monitoring-toolbar-submit'));
  assert.match(submit, /monitoring-toolbar-icon[^>]*>close</);
  assert.match(submit, /monitoring-toolbar-icon[^>]*>arrow_forward</);
  assert.match(submit, /クリア/);
  assert.ok(!html.includes('>delete<'), '押下即実行のdeleteアイコンは撤去');
  assert.equal((html.match(/slot="container"/g) ?? []).length, 5);
});

test('ツールバー: 電文投入・リスト消去はチェック0件、リスト全消は一覧0件でsoftDisabled。選択中は「選択中」、送信は対象があるときだけ点滅して押せる', () => {
  const empty = renderToolbar(toolbarModel());
  assert.match(button(empty, '電文投入'), /soft-disabled=""/);
  assert.match(button(empty, 'リスト消去'), /soft-disabled=""/);
  assert.match(button(empty, 'リスト全消'), /soft-disabled=""/);
  assert.match(empty, /soft-disabled=""[^>]*>(?:(?!<\/md-gb-button>).)*クリア/);
  assert.ok(!empty.includes('monitoring-send-ready'));
  const stockOnly = renderToolbar(toolbarModel({ counts: { checked: 0, stock: 3 } }));
  assert.match(button(stockOnly, 'リスト消去'), /soft-disabled=""/);
  assert.ok(!/soft-disabled/.test(button(stockOnly, 'リスト全消')));
  const checked = renderToolbar(toolbarModel({ counts: { checked: 2, stock: 3 } }));
  assert.ok(!/soft-disabled/.test(button(checked, 'リスト消去')));
  // リスト消去を選択中
  const selected = renderToolbar(
    toolbarModel({ selection: 'delete', counts: { checked: 2, stock: 3 } }),
  );
  assert.match(selected, /aria-label="リスト消去、選択中"/);
  assert.match(button(selected, 'リスト消去'), /monitoring-toolbar-selected/);
  assert.ok(
    !/monitoring-toolbar-selected/.test(button(selected, 'リスト全消')),
    '排他: 選択は1つだけ',
  );
  assert.match(selected, /aria-label="リスト消去を送信"/);
  assert.match(selected, /monitoring-send-ready/);
  // 選択中にチェックが0件になっても選択は維持し、送信だけ押せない
  const lost = renderToolbar(
    toolbarModel({ selection: 'delete', counts: { checked: 0, stock: 3 } }),
  );
  assert.match(lost, /aria-label="リスト消去、選択中"/);
  assert.ok(!lost.includes('monitoring-send-ready'));
  assert.match(lost, /aria-label="リスト消去を送信"[^>]*/);
  assert.match(lost.slice(lost.indexOf('aria-label="リスト消去を送信"') - 60), /soft-disabled=""/);
  // リスト全消を選択中
  const all = renderToolbar(
    toolbarModel({ selection: 'deleteAll', counts: { checked: 0, stock: 3 } }),
  );
  assert.match(all, /aria-label="リスト全消、選択中"/);
  assert.match(all, /aria-label="リスト全消を送信"/);
  assert.match(all, /monitoring-send-ready/);
  assert.match(renderToolbar(toolbarModel()), /aria-label="操作を送信"/);
});

test('ツールバー: 子階層に入ると階層名が出て、<<・<が押せる(共通部品の階層対応)', () => {
  const html = renderToolbar(toolbarModel({ history: ['training-root', 'training-child'] }));
  const icons = [...html.matchAll(/<md-gb-icon-button\b([^>]*)>/g)].map((m) => m[1]!);
  assert.ok(icons.every((attributes) => !/disabled=""/.test(attributes)));
  assert.match(html, /monitoring-toolbar-title/);
});

test('training画面は監視と同じ外枠classを持つ', () => {
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
          toolbar: React.createElement(TrainingToolbar, { model: toolbarModel() }),
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

test('一覧: 行ごとに投入ステータス(未投入・投入済み・投入失敗)を表示し、色はトークンのみ', () => {
  const html = render({
    ...ready,
    history: [
      { ...entry('a', ['x']), injectionStatus: 'pending' },
      { ...entry('c', ['x']), injectionStatus: 'failed' },
    ],
    injected: [injection(TID_1, '2026-10-12T01:02:03.000Z', [['大雨警報', 'VPWW55']])],
  });
  assert.match(html, /data-status="pending">未投入</);
  assert.match(html, /data-status="injected">投入済み</);
  assert.match(html, /data-status="failed">投入失敗</);
  const css = readFileSync(new URL('../src/training/training.css', import.meta.url), 'utf8');
  const block = css.match(/\.training-row-status[^{]*\{[^}]*\}/g)!.join('\n');
  assert.match(block, /var\(--md-sys-color-error\)/);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(block));
  assert.match(css, /\.training-row \{[^}]*block-size: 48px/);
});

test('一覧の並び: 未投入 → 投入失敗 → 投入済みの順で、まとまりの中は新しい順', () => {
  const html = render({
    ...ready,
    history: [
      { ...entry('f1', ['x']), injectionStatus: 'failed' },
      { ...entry('p1', ['x']), injectionStatus: 'pending' },
      { ...entry('f2', ['x']), injectionStatus: 'failed' },
      { ...entry('p2', ['x']), injectionStatus: 'pending' },
    ],
    injected: [
      injection(TID_1, '2026-10-12T01:00:02.000Z', [['新', 'VPWW55']]),
      injection(TID_2, '2026-10-12T01:00:01.000Z', [['旧', 'VPWW55']]),
    ],
  });
  const order = [...html.matchAll(/data-(?:entry|training)-id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['p1', 'p2', 'f1', 'f2', TID_1, TID_2]);
  assert.match(html, /4／20件/);
});

test('投入済みの行: 注入1回につき1行、title・種別を「、」連結、チェック欄もボタンも無い', () => {
  const html = render({
    ...ready,
    injected: [
      injection(TID_1, '2026-10-12T01:02:03.000Z', [
        ['東京都大雨警報', 'VPWW55'],
        [null, 'VPHW50'],
      ]),
    ],
  });
  const row = html.match(new RegExp(`<li[^>]*data-training-id="${TID_1}">.*?</li>`))![0];
  assert.match(row, /10:02:03/); // JST HH:mm:ss
  assert.match(row, /class="training-row-items">東京都大雨警報、VPHW50</);
  assert.match(row, /class="training-row-type">VPWW55、VPHW50</);
  assert.match(row, /data-status="injected">投入済み</);
  assert.ok(!/<input/.test(row), 'チェック欄を置かない');
  assert.ok(!/<button/.test(row), '押しても何も開かない');
  assert.match(html, /0／20件/, '件数はローカル行だけで数える');
});

test('投入済み一覧の取得失敗: 状態行に alert。生成失敗・保存失敗が優先され、ローカル行は表示を続ける', () => {
  const failed = render({
    ...ready,
    history: [entry('a', ['x'])],
    injectedLoadFailed: true,
  });
  assert.match(failed, /role="alert"[^>]*>投入済みの一覧を取得できませんでした/);
  assert.match(failed, /data-entry-id="a"/);
  const withSave = render({ ...ready, injectedLoadFailed: true, saveFailed: true });
  assert.match(withSave, />一覧を保存できませんでした</);
  assert.ok(!withSave.includes('投入済みの一覧を取得できませんでした'));
  const withGen = render({
    ...ready,
    injectedLoadFailed: true,
    generation: { phase: 'failed', message: '訓練電文を生成できませんでした。' },
  });
  assert.match(withGen, />訓練電文を生成できませんでした。</);
  assert.ok(!withGen.includes('投入済みの一覧を取得できませんでした'));
});
