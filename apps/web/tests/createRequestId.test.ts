import assert from 'node:assert/strict';
import test from 'node:test';
import { isFetchControlRequestId } from '@wx-viewer-poc/shared';
import { createRequestId } from '../src/monitoring/createRequestId.ts';
import { createMonitoringOperationController } from '../src/monitoring/monitoringOperationController.ts';
import { monitoringOperationMessage } from '../src/monitoring/monitoringOperationMessage.ts';
import { createToolbarLocalState } from '../src/monitoring/monitoringToolbarState.ts';

test('HTTP相当: randomUUIDなしでも暗号乱数からUUID v4を生成する', (t) => {
  let calls = 0;
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
  t.after(() => Object.defineProperty(globalThis, 'crypto', originalCrypto));
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      getRandomValues(bytes: Uint8Array) {
        calls++;
        assert.equal(bytes.length, 16);
        bytes.set([0, 1, 2, 3, 4, 5, 0xf6, 7, 0x78, 9, 10, 11, 12, 13, 14, 15]);
        return bytes;
      },
    } as Crypto,
  });
  const id = createRequestId();
  assert.equal(id, '00010203-0405-4607-b809-0a0b0c0d0e0f');
  assert.equal(isFetchControlRequestId(id), true);
  assert.equal(calls, 1);
});

test('暗号乱数の失敗は準備失敗として表示し、送信しない', (t) => {
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
  t.after(() => Object.defineProperty(globalThis, 'crypto', originalCrypto));
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      getRandomValues() {
        throw new Error('暗号乱数を使用できません');
      },
    } as unknown as Crypto,
  });
  let sends = 0;
  const controller = createMonitoringOperationController({
    requestIdFactory: createRequestId,
    client: {
      submit: async () => {
        sends++;
        throw new Error('送信してはならない');
      },
      find: async () => {
        throw new Error('照会してはならない');
      },
    },
    setTimeout: () => {
      throw new Error('タイマーを予約してはならない');
    },
    clearTimeout: () => undefined,
  });
  controller.submit('start');
  assert.deepEqual(controller.getSnapshot(), {
    phase: 'rejected',
    request: null,
    reason: 'request_id_unavailable',
  });
  assert.equal(
    monitoringOperationMessage(createToolbarLocalState('monitor-root'), controller.getSnapshot()),
    '取得操作の要求を準備できませんでした',
  );
  assert.equal(sends, 0);
  controller.dispose();
});
