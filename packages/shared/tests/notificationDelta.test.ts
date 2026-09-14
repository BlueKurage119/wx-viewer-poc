import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNotificationDeltaQuery } from '../src/notificationDelta.js';

test('parseNotificationDeltaQuery: 正当なクエリを受理する', () => {
  const result = parseNotificationDeltaQuery({ terminalId: 'hkeagh01', cursor: '0' });
  assert.deepEqual(result, { terminalId: 'hkeagh01', cursor: '0' });

  const result2 = parseNotificationDeltaQuery({ terminalId: 'ktrcph01', cursor: '1234' });
  assert.deepEqual(result2, { terminalId: 'ktrcph01', cursor: '1234' });
});

test('parseNotificationDeltaQuery: 欠落・余剰キー・不正な型・不正なカーソルを拒絶して null を返す', () => {
  // 欠落
  assert.equal(parseNotificationDeltaQuery({}), null);
  assert.equal(parseNotificationDeltaQuery({ terminalId: 'hkeagh01' }), null);
  assert.equal(parseNotificationDeltaQuery({ cursor: '0' }), null);

  // 余剰キー
  assert.equal(
    parseNotificationDeltaQuery({ terminalId: 'hkeagh01', cursor: '0', limit: 10 }),
    null,
  );
  assert.equal(
    parseNotificationDeltaQuery({ terminalId: 'hkeagh01', cursor: '0', extra: 'foo' }),
    null,
  );

  // 空文字
  assert.equal(parseNotificationDeltaQuery({ terminalId: '', cursor: '0' }), null);
  assert.equal(parseNotificationDeltaQuery({ terminalId: 'hkeagh01', cursor: '' }), null);

  // 重複キー（Express で配列化された場合）
  assert.equal(
    parseNotificationDeltaQuery({ terminalId: ['hkeagh01', 'hkeagh02'], cursor: '0' }),
    null,
  );
  assert.equal(parseNotificationDeltaQuery({ terminalId: 'hkeagh01', cursor: ['0', '1'] }), null);

  // カーソル不正（前ゼロ、負数、小数、17桁、全角等）
  assert.equal(parseNotificationDeltaQuery({ terminalId: 'hkeagh01', cursor: '01' }), null);
  assert.equal(parseNotificationDeltaQuery({ terminalId: 'hkeagh01', cursor: '-1' }), null);
  assert.equal(parseNotificationDeltaQuery({ terminalId: 'hkeagh01', cursor: '1.5' }), null);
  assert.equal(
    parseNotificationDeltaQuery({ terminalId: 'hkeagh01', cursor: '12345678901234567' }),
    null,
  );
  assert.equal(parseNotificationDeltaQuery({ terminalId: 'hkeagh01', cursor: '１' }), null);

  // 非オブジェクト・null
  assert.equal(parseNotificationDeltaQuery(null), null);
  assert.equal(parseNotificationDeltaQuery(undefined), null);
  assert.equal(parseNotificationDeltaQuery('terminalId=a&cursor=0'), null);
  assert.equal(parseNotificationDeltaQuery([]), null);
});
