import './setupEnv.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ViewPlacement } from '../src/map/types.ts';
import {
  createViewportLayoutSync,
  decideViewportLayoutAction,
  type ViewportLayoutMeasurement,
  type ViewportLayoutSyncDependencies,
} from '../src/map/viewportLayoutSync.ts';

function measurement(
  overrides: Partial<ViewportLayoutMeasurement> = {},
): ViewportLayoutMeasurement {
  return {
    containerWidth: 952,
    containerHeight: 624,
    rightColumnWidth: 288,
    bottomCardHeight: 110,
    ...overrides,
  };
}

interface RecordedDependencies extends ViewportLayoutSyncDependencies {
  calls: string[];
  alignedMeasurements: ViewportLayoutMeasurement[];
}

function createRecordedDependencies(
  getPlacement: () => ViewPlacement,
  measurements: ViewportLayoutMeasurement[],
): RecordedDependencies {
  const calls: string[] = [];
  const alignedMeasurements: ViewportLayoutMeasurement[] = [];
  let measureIndex = 0;

  return {
    calls,
    alignedMeasurements,
    measure: () => {
      calls.push('measure');
      const m = measurements[Math.min(measureIndex, measurements.length - 1)];
      measureIndex += 1;
      return m;
    },
    getPlacement,
    invalidateSize: () => {
      calls.push('invalidateSize');
    },
    alignVenue: (m) => {
      calls.push('alignVenue');
      alignedMeasurements.push(m);
    },
    onReturningAligned: () => {
      calls.push('onReturningAligned');
    },
  };
}

test('decideViewportLayoutAction: 3状態 × コンテナ0/正の6通りが§4.2の表と一致する', () => {
  const zeroWidth = measurement({ containerWidth: 0 });
  const zeroHeight = measurement({ containerHeight: 0 });
  const positive = measurement();

  assert.equal(decideViewportLayoutAction('initial', zeroWidth), 'skip');
  assert.equal(decideViewportLayoutAction('initial', zeroHeight), 'skip');
  assert.equal(decideViewportLayoutAction('initial', positive), 'align-venue');

  assert.equal(decideViewportLayoutAction('manual', zeroWidth), 'skip');
  assert.equal(decideViewportLayoutAction('manual', positive), 'resize-only');

  assert.equal(decideViewportLayoutAction('returning', zeroHeight), 'skip');
  assert.equal(decideViewportLayoutAction('returning', positive), 'align-venue');
});

test('T1: initial + 正の寸法で sync() を1回呼ぶと invalidateSize → alignVenue の順に1回ずつ呼ばれ、alignVenueに渡るR/Bがmeasure()の値と一致する', () => {
  const m = measurement({ rightColumnWidth: 300, bottomCardHeight: 120 });
  const deps = createRecordedDependencies(() => 'initial', [m]);
  const sync = createViewportLayoutSync(deps);

  sync.sync();

  assert.deepEqual(deps.calls, ['measure', 'invalidateSize', 'alignVenue']);
  assert.equal(deps.alignedMeasurements.length, 1);
  assert.equal(deps.alignedMeasurements[0].rightColumnWidth, 300);
  assert.equal(deps.alignedMeasurements[0].bottomCardHeight, 120);
});

test('T2 (確定事項2の本体): initial のままB/Rが変化しても sync() の各回で最新値でalignVenueが呼ばれる', () => {
  const measurements = [
    measurement({ rightColumnWidth: 288, bottomCardHeight: 110 }),
    measurement({ rightColumnWidth: 288, bottomCardHeight: 150 }),
    measurement({ rightColumnWidth: 320, bottomCardHeight: 150 }),
  ];
  const deps = createRecordedDependencies(() => 'initial', measurements);
  const sync = createViewportLayoutSync(deps);

  sync.sync();
  sync.sync();
  sync.sync();

  assert.equal(deps.alignedMeasurements.length, 3);
  assert.deepEqual(
    deps.alignedMeasurements.map((mm) => [mm.rightColumnWidth, mm.bottomCardHeight]),
    [
      [288, 110],
      [288, 150],
      [320, 150],
    ],
  );
});

test('T3: manual では invalidateSize だけが呼ばれ、alignVenue・onReturningAlignedは呼ばれない', () => {
  const deps = createRecordedDependencies(() => 'manual', [measurement()]);
  const sync = createViewportLayoutSync(deps);

  sync.sync();

  assert.deepEqual(deps.calls, ['measure', 'invalidateSize']);
});

test('T4: returning では invalidateSize → alignVenue → onReturningAligned の順に1回ずつ呼ばれる', () => {
  const deps = createRecordedDependencies(() => 'returning', [measurement()]);
  const sync = createViewportLayoutSync(deps);

  sync.sync();

  assert.deepEqual(deps.calls, ['measure', 'invalidateSize', 'alignVenue', 'onReturningAligned']);
});

test('T5: 地図コンテナ幅0または高さ0の場合はmeasureを除きどの依存も呼ばれない。R=0・B=0かつコンテナ正の場合はinitialでalignVenueが呼ばれる', () => {
  const zeroWidthDeps = createRecordedDependencies(
    () => 'initial',
    [measurement({ containerWidth: 0 })],
  );
  createViewportLayoutSync(zeroWidthDeps).sync();
  assert.deepEqual(zeroWidthDeps.calls, ['measure']);

  const zeroHeightDeps = createRecordedDependencies(
    () => 'initial',
    [measurement({ containerHeight: 0 })],
  );
  createViewportLayoutSync(zeroHeightDeps).sync();
  assert.deepEqual(zeroHeightDeps.calls, ['measure']);

  const zeroRbDeps = createRecordedDependencies(
    () => 'initial',
    [measurement({ rightColumnWidth: 0, bottomCardHeight: 0 })],
  );
  createViewportLayoutSync(zeroRbDeps).sync();
  assert.deepEqual(zeroRbDeps.calls, ['measure', 'invalidateSize', 'alignVenue']);
});

test('T6: dispose()後のsync()ではmeasureを含めどの依存も呼ばれない', () => {
  const deps = createRecordedDependencies(() => 'initial', [measurement()]);
  const sync = createViewportLayoutSync(deps);

  sync.dispose();
  sync.sync();

  assert.deepEqual(deps.calls, []);
});

test('T7 (確定事項1): rAF差し替え環境でsync()を呼ぶと、戻り値を返した時点でalignVenueが呼ばれ済みで、rAFの呼出し記録が0件', () => {
  const rafCalls: unknown[] = [];
  const originalGlobalRaf = (globalThis as { requestAnimationFrame?: unknown })
    .requestAnimationFrame;
  const originalWindowRaf = (
    globalThis as unknown as { window?: { requestAnimationFrame?: unknown } }
  ).window?.requestAnimationFrame;

  const fakeRaf = (cb: unknown) => {
    rafCalls.push(cb);
    return 0;
  };
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = fakeRaf;
  const win = (globalThis as unknown as { window?: { requestAnimationFrame?: unknown } }).window;
  if (win) {
    win.requestAnimationFrame = fakeRaf;
  }

  try {
    const deps = createRecordedDependencies(() => 'initial', [measurement()]);
    const sync = createViewportLayoutSync(deps);

    sync.sync();

    assert.deepEqual(deps.calls, ['measure', 'invalidateSize', 'alignVenue']);
    assert.equal(rafCalls.length, 0);
  } finally {
    (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = originalGlobalRaf;
    if (win) {
      win.requestAnimationFrame = originalWindowRaf;
    }
  }
});
