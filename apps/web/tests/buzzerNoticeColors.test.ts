import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBuzzerNoticeColors } from '../src/theme/buzzerNoticeColors.ts';
import { createSemanticColors } from '../src/theme/semanticColors.ts';

test('Issue #63: 下部表示専用色は問いかけを薄赤＋赤文字、非常を赤＋白文字にする', () => {
  for (const dark of [false, true]) {
    const colors = createBuzzerNoticeColors(dark);
    assert.equal(colors['--wx-buzzer-notice-question-container'], '#ffdad5');
    assert.equal(colors['--wx-buzzer-notice-question-on-container'], '#410001');
    assert.equal(colors['--wx-buzzer-notice-question-outline'], '#d74034');
    assert.equal(colors['--wx-buzzer-notice-emergency-container'], '#b4271f');
    assert.equal(colors['--wx-buzzer-notice-emergency-on-container'], '#ffffff');
    assert.equal(colors['--wx-buzzer-notice-emergency-outline'], '#ffb4aa');
    assert.equal(colors['--wx-buzzer-header-emergency-container'], '#b4271f');
    assert.equal(colors['--wx-buzzer-header-emergency-on-container'], '#ffffff');
    assert.equal(colors['--wx-buzzer-header-emergency-container-dark'], '#910809');
    assert.equal(colors['--wx-buzzer-header-emergency-on-container-dark'], '#ffdad5');
  }
});

test('Issue #63: 下部表示専用色を変えてもIssue #90の通知区分色は維持される', () => {
  const colors = createSemanticColors(true);
  assert.equal(colors['--wx-notice-question-container'], '#910809');
  assert.equal(colors['--wx-notice-question-on-container'], '#ffdad5');
  assert.equal(colors['--wx-notice-emergency-container'], '#9200dc');
  assert.equal(colors['--wx-notice-emergency-on-container'], '#ffffff');
});
