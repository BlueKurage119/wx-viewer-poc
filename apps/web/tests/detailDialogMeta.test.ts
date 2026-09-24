import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as unknown as { React: typeof React }).React = React;

import {
  formatDetailDialogMeta,
  type DetailDialogMeta,
} from '../src/map/detail/detailDialogMeta.ts';
import { DetailDialogInner } from '../src/map/detail/DetailDialog.tsx';

const el = React.createElement;
const NOW = new Date('2026-09-24T10:00:00+09:00');

// AC-3: target null・time.value null・isTraining true/false/null の各組合せ
test('formatDetailDialogMeta: target/time が null なら要素ごと省く', () => {
  const meta: DetailDialogMeta = {
    title: 'x',
    target: null,
    time: { kind: 'issued', value: null },
    isTraining: null,
  };
  assert.deepEqual(formatDetailDialogMeta(meta, NOW), {
    target: null,
    time: null,
    trainingLabel: null,
  });
});

test('formatDetailDialogMeta: target あり・time.value あり(issued)', () => {
  const meta: DetailDialogMeta = {
    title: 'x',
    target: '江東区',
    time: { kind: 'issued', value: '2026-09-24T05:00:00+09:00' },
    isTraining: false,
  };
  assert.deepEqual(formatDetailDialogMeta(meta, NOW), {
    target: '江東区',
    time: '05:00発表',
    trainingLabel: null,
  });
});

test('formatDetailDialogMeta: time.value あり(observed)、isTraining true で「訓練」', () => {
  const meta: DetailDialogMeta = {
    title: 'x',
    target: null,
    time: { kind: 'observed', value: '2026-09-23T14:10:00+09:00' },
    isTraining: true,
  };
  assert.deepEqual(formatDetailDialogMeta(meta, NOW), {
    target: null,
    time: '9/23 14:10観測',
    trainingLabel: '訓練',
  });
});

test('formatDetailDialogMeta: isTraining が null のとき「訓練」を出さない', () => {
  const meta: DetailDialogMeta = {
    title: 'x',
    target: '東京地方',
    time: { kind: 'issued', value: '2026-09-24T05:00:00+09:00' },
    isTraining: null,
  };
  assert.equal(formatDetailDialogMeta(meta, NOW).trainingLabel, null);
});

// AC-3: renderToStaticMarkup で DetailDialogInner (open=true) を描画する
// createPortal はサーバーレンダラ未対応のため、portal でラップしない内側の実体を直接描画する
// (公開コンポーネント DetailDialog は createPortal(document.body) でラップするのみ)。
test('DetailDialogInner: open=true で見出し・対象・時刻・閉じる・aria-labelledby が出力される', () => {
  const meta: DetailDialogMeta = {
    title: '警報等時系列',
    target: '江東区',
    time: { kind: 'issued', value: '2026-09-24T05:00:00+09:00' },
    isTraining: false,
  };
  const html = renderToStaticMarkup(
    el(DetailDialogInner, { open: true, meta, onClose: () => {} }, el('p', null, '本文')),
  );

  assert.match(html, /警報等時系列/);
  assert.match(html, /江東区/);
  assert.match(html, /05:00発表/);
  assert.match(html, /aria-label="閉じる"/);
  assert.match(html, /aria-labelledby="[^"]+"/);
  assert.match(html, /<dialog/);
});

// AC-8b: 閉じるボタンは×アイコンのみ（可視テキストなし）。アクセシブルネームは aria-label
test('DetailDialogInner: 閉じるボタンはアイコンのみで aria-label="閉じる"、アイコンは aria-hidden', () => {
  const meta: DetailDialogMeta = {
    title: 'x',
    target: null,
    time: { kind: 'issued', value: null },
    isTraining: null,
  };
  const html = renderToStaticMarkup(el(DetailDialogInner, { open: true, meta, onClose: () => {} }));

  const iconButtonMatch = html.match(/<md-gb-icon-button[^>]*>(.*?)<\/md-gb-icon-button>/s);
  assert.ok(iconButtonMatch, 'md-gb-icon-button が出力される');
  const [iconButtonTag, iconButtonInner] = iconButtonMatch as unknown as [string, string];
  assert.match(iconButtonTag, /aria-label="閉じる"/);
  assert.match(iconButtonTag, /title="閉じる"/);
  assert.match(iconButtonInner, /<span[^>]*aria-hidden="true"[^>]*>close<\/span>/);
});

test('DetailDialogInner: isTraining=true で「訓練」ラベルが出力される', () => {
  const meta: DetailDialogMeta = {
    title: '地域時系列予報',
    target: null,
    time: { kind: 'issued', value: null },
    isTraining: true,
  };
  const html = renderToStaticMarkup(el(DetailDialogInner, { open: true, meta, onClose: () => {} }));

  assert.match(html, /訓練/);
});

test('DetailDialogInner: open=false のとき本文が出力されない', () => {
  const meta: DetailDialogMeta = {
    title: 'x',
    target: null,
    time: { kind: 'issued', value: null },
    isTraining: null,
  };
  const html = renderToStaticMarkup(
    el(DetailDialogInner, { open: false, meta, onClose: () => {} }, el('p', null, '本文')),
  );
  assert.doesNotMatch(html, /本文/);
});
