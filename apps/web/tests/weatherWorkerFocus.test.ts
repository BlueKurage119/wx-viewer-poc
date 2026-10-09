import './setupEnv.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GbButton } from '../src/components/md/GbButton.tsx';

test('GbButtonのsoftDisabledは登録前でも認識される属性で伝え、native disabledを付けない', () => {
  assert.equal(
    renderToStaticMarkup(
      React.createElement(GbButton, { color: 'filled', size: 'sm', softDisabled: true }, '操作'),
    ),
    '<md-gb-button color="filled" size="sm" soft-disabled="">操作</md-gb-button>',
  );
  assert.equal(
    renderToStaticMarkup(React.createElement(GbButton, { color: 'filled', size: 'sm' }, '操作')),
    '<md-gb-button color="filled" size="sm">操作</md-gb-button>',
  );
});
