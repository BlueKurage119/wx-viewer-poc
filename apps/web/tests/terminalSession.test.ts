import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createTerminalSessionStore,
  type TerminalSessionDependencies,
} from '../src/session/terminalSession.ts';

interface FakeStorageMock {
  readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
  readonly store: Map<string, string>;
  getItemCalls: number;
  setItemCalls: number;
}

function createFakeStorage(initialData?: Record<string, string>): FakeStorageMock {
  const store = new Map<string, string>(Object.entries(initialData ?? {}));
  const mock: FakeStorageMock = {
    store,
    getItemCalls: 0,
    setItemCalls: 0,
    storage: {
      getItem(key: string): string | null {
        mock.getItemCalls++;
        return store.get(key) ?? null;
      },
      setItem(key: string, value: string): void {
        mock.setItemCalls++;
        store.set(key, value);
      },
    },
  };
  return mock;
}

describe('terminalSession web module (AC2 - AC5)', () => {
  it('AC2 web 新規: 空 storage とゼロ乱数で 00000000-0000-4000-8000-000000000000 と一致し、別固定値でも version/variant が正しく設定される', () => {
    const fake = createFakeStorage();
    let randomCalls = 0;
    const dependencies: TerminalSessionDependencies = {
      getStorage: () => fake.storage,
      fillRandom: (bytes: Uint8Array) => {
        randomCalls++;
        bytes.fill(0);
      },
    };

    const store = createTerminalSessionStore(dependencies);
    const result = store.getOrCreate('hkeagh01');

    assert.deepStrictEqual(result, {
      status: 'ready',
      sessionId: '00000000-0000-4000-8000-000000000000',
      persistence: 'session',
    });
    assert.strictEqual(randomCalls, 1);
    assert.strictEqual(fake.setItemCalls, 1);
    assert.strictEqual(
      fake.store.get('wx-viewer:terminal-session:v1:hkeagh01'),
      '00000000-0000-4000-8000-000000000000',
    );

    // 別の固定乱数値でも version(4) と variant(8..b) が正しく設定されることの検証
    // すべて 0xff のバイト列を渡す -> byte 6: (0xff & 0x0f) | 0x40 = 0x4f
    //                            -> byte 8: (0xff & 0x3f) | 0x80 = 0xbf
    const fake2 = createFakeStorage();
    let randomCalls2 = 0;
    const dependencies2: TerminalSessionDependencies = {
      getStorage: () => fake2.storage,
      fillRandom: (bytes: Uint8Array) => {
        randomCalls2++;
        bytes.fill(0xff);
      },
    };
    const store2 = createTerminalSessionStore(dependencies2);
    const result2 = store2.getOrCreate('hkeagh01');

    assert.deepStrictEqual(result2, {
      status: 'ready',
      sessionId: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
      persistence: 'session',
    });
    assert.strictEqual(randomCalls2, 1);
    assert.strictEqual(fake2.setItemCalls, 1);
  });

  it('AC3 継続: 同一 storage を渡す別 store と元 store で複数回呼び、同一 ID・追加乱数 0 回・追加書込 0 回。端末 A->B->A で A は元ID、Bは別ID。呼出し間隔でも同一ID', async () => {
    const fake = createFakeStorage();
    let randomCount = 0;
    // 端末ごとに異なる乱数を返す
    const randomSeeds = [
      new Uint8Array(16).fill(0x11), // 端末 A
      new Uint8Array(16).fill(0x22), // 端末 B
    ];
    const dependencies: TerminalSessionDependencies = {
      getStorage: () => fake.storage,
      fillRandom: (bytes: Uint8Array) => {
        const seed = randomSeeds[randomCount++] ?? new Uint8Array(16).fill(0x99);
        bytes.set(seed);
      },
    };

    const storeA = createTerminalSessionStore(dependencies);
    const resultA1 = storeA.getOrCreate('termA');
    assert.strictEqual(resultA1.status, 'ready');
    const idA = resultA1.sessionId;
    assert.strictEqual(randomCount, 1);
    assert.strictEqual(fake.setItemCalls, 1);

    // 元の store で再度 termA を呼ぶ -> メモリから返却、乱数 0 回、書込 0 回
    const resultA2 = storeA.getOrCreate('termA');
    assert.deepStrictEqual(resultA2, resultA1);
    assert.strictEqual(randomCount, 1);
    assert.strictEqual(fake.setItemCalls, 1);

    // 端末 B を呼ぶ -> 新規乱数で別 ID
    const resultB = storeA.getOrCreate('termB');
    assert.strictEqual(resultB.status, 'ready');
    const idB = resultB.sessionId;
    assert.notStrictEqual(idA, idB);
    assert.strictEqual(randomCount, 2);
    assert.strictEqual(fake.setItemCalls, 2);

    // 端末 A に戻る (A -> B -> A) -> A は元の ID、追加乱数 0 回、追加書込 0 回
    const resultA3 = storeA.getOrCreate('termA');
    assert.deepStrictEqual(resultA3, resultA1);
    assert.strictEqual(randomCount, 2);
    assert.strictEqual(fake.setItemCalls, 2);

    // 一時切断を模した呼出し間隔（タイマー待機）を挟んでも ID に時刻依存がない
    await new Promise((resolve) => setTimeout(resolve, 50));
    const resultA4 = storeA.getOrCreate('termA');
    assert.deepStrictEqual(resultA4, resultA1);
    assert.strictEqual(randomCount, 2);
    assert.strictEqual(fake.setItemCalls, 2);

    // AC2 と同じ storage を渡す「別 store」で termA を呼ぶ -> storage から回復、追加乱数 0 回、追加書込 0 回
    const storeAnother = createTerminalSessionStore(dependencies);
    const resultAFromAnother = storeAnother.getOrCreate('termA');
    assert.deepStrictEqual(resultAFromAnother, {
      status: 'ready',
      sessionId: idA,
      persistence: 'session',
    });
    assert.strictEqual(randomCount, 2);
    assert.strictEqual(fake.setItemCalls, 2);
  });

  it('AC4 新規タブ相当: 独立した空 storage と異なる固定乱数を使って別 ID となる。壊れた保存値は一度だけ置換され、次回は維持される', () => {
    // 独立した空 storage と異なる固定乱数
    const fake1 = createFakeStorage();
    const fake2 = createFakeStorage();

    const store1 = createTerminalSessionStore({
      getStorage: () => fake1.storage,
      fillRandom: (bytes) => bytes.fill(0x11),
    });
    const store2 = createTerminalSessionStore({
      getStorage: () => fake2.storage,
      fillRandom: (bytes) => bytes.fill(0x22),
    });

    const res1 = store1.getOrCreate('term1');
    const res2 = store2.getOrCreate('term1');
    assert.strictEqual(res1.status, 'ready');
    assert.strictEqual(res2.status, 'ready');
    assert.notStrictEqual(res1.sessionId, res2.sessionId);

    // 壊れた保存値（無効なUUID文字列）の置換テスト
    const brokenStorage = createFakeStorage({
      'wx-viewer:terminal-session:v1:termCorrupt': 'not-a-valid-uuid-value',
    });
    let randomCount = 0;
    const replaceStore = createTerminalSessionStore({
      getStorage: () => brokenStorage.storage,
      fillRandom: (bytes) => {
        randomCount++;
        bytes.fill(0x33);
      },
    });

    // 1回目: 壊れた値を無視して新規生成し、storage を置換する
    const replacedRes = replaceStore.getOrCreate('termCorrupt');
    assert.strictEqual(replacedRes.status, 'ready');
    assert.strictEqual(randomCount, 1);
    assert.strictEqual(brokenStorage.setItemCalls, 1);
    const newId = replacedRes.sessionId;
    assert.strictEqual(brokenStorage.store.get('wx-viewer:terminal-session:v1:termCorrupt'), newId);

    // 2回目: 同じ store または別 store から呼んでも、置換された値が維持される
    const nextStore = createTerminalSessionStore({
      getStorage: () => brokenStorage.storage,
      fillRandom: () => {
        randomCount++;
      },
    });
    const maintainedRes = nextStore.getOrCreate('termCorrupt');
    assert.deepStrictEqual(maintainedRes, {
      status: 'ready',
      sessionId: newId,
      persistence: 'session',
    });
    // 乱数呼び出しは増えない
    assert.strictEqual(randomCount, 1);
  });

  it('AC5 障害: storage getter/getItem/setItem がそれぞれ throw するケースは、固定乱数の期待 ID と {status: "ready", persistence: "memory"} に完全一致。同 store 再呼出しは同一ID・追加乱数0回、別storeは新規乱数で別ID。乱数throw時のみ unavailable', () => {
    const fixedRandom = (bytes: Uint8Array) => bytes.fill(0x44);
    // 0x44 -> 44444444-4444-4444-8444-444444444444
    // (byte 6: 0x44, byte 8: (0x44 & 0x3f)|0x80 = 0x84)
    const expectedId = '44444444-4444-4444-8444-444444444444';

    // ケース 1: getStorage() が throw
    {
      let randomCalls = 0;
      const store = createTerminalSessionStore({
        getStorage: () => {
          throw new Error('Storage disabled / quota exceeded');
        },
        fillRandom: (bytes) => {
          randomCalls++;
          fixedRandom(bytes);
        },
      });

      const res = store.getOrCreate('termFail');
      assert.deepStrictEqual(res, {
        status: 'ready',
        sessionId: expectedId,
        persistence: 'memory',
      });
      assert.strictEqual(randomCalls, 1);

      // 同一 store の再呼出し -> メモリキャッシュから同一 ID、追加乱数 0 回
      const resAgain = store.getOrCreate('termFail');
      assert.deepStrictEqual(resAgain, res);
      assert.strictEqual(randomCalls, 1);

      // 別 store に作り直すと新規乱数で別 ID
      const anotherStore = createTerminalSessionStore({
        getStorage: () => {
          throw new Error('Storage disabled');
        },
        fillRandom: (bytes) => {
          bytes.fill(0x55);
        },
      });
      const resAnother = anotherStore.getOrCreate('termFail');
      assert.strictEqual(resAnother.status, 'ready');
      assert.notStrictEqual(resAnother.sessionId, expectedId);
      assert.strictEqual(resAnother.persistence, 'memory');
    }

    // ケース 2: getItem() が throw
    {
      let setItemCalls = 0;
      const store = createTerminalSessionStore({
        getStorage: () => ({
          getItem: () => {
            throw new Error('SecurityError: Access is denied');
          },
          setItem: () => {
            setItemCalls++;
          },
        }),
        fillRandom: fixedRandom,
      });

      const res = store.getOrCreate('termFailItem');
      assert.deepStrictEqual(res, {
        status: 'ready',
        sessionId: expectedId,
        persistence: 'memory',
      });
      assert.strictEqual(setItemCalls, 0);
    }

    // ケース 3: setItem() が throw
    {
      const store = createTerminalSessionStore({
        getStorage: () => ({
          getItem: () => null,
          setItem: () => {
            throw new Error('QuotaExceededError');
          },
        }),
        fillRandom: fixedRandom,
      });

      const res = store.getOrCreate('termFailSet');
      assert.deepStrictEqual(res, {
        status: 'ready',
        sessionId: expectedId,
        persistence: 'memory',
      });
    }

    // ケース 4: 乱数 throw で利用可能な ID がないケースだけ {status:'unavailable',reason:'random'}
    {
      const store = createTerminalSessionStore({
        getStorage: () => createFakeStorage().storage,
        fillRandom: () => {
          throw new Error('Crypto error');
        },
      });

      const res = store.getOrCreate('termFailCrypto');
      assert.deepStrictEqual(res, {
        status: 'unavailable',
        reason: 'random',
      });
    }
  });

  it('空文字の terminalId は例外を投げる', () => {
    const store = createTerminalSessionStore({
      getStorage: () => createFakeStorage().storage,
      fillRandom: (bytes) => bytes.fill(0),
    });

    assert.throws(() => store.getOrCreate(''), {
      name: 'Error',
      message: 'terminalId must be a non-empty string',
    });
    // @ts-expect-error test non-string input
    assert.throws(() => store.getOrCreate(null), {
      name: 'Error',
      message: 'terminalId must be a non-empty string',
    });
  });
});
