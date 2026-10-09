import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './helpers/acquisitionWorkerHostFixture.js';
import type { WeatherEpoch } from '../src/runtime/weatherContracts.js';

test('reader open例外後のnull DB世代initialization.failedを受理し理由・通知を維持する', async () => {
  let attempts = 0;
  const f = setup('normal', async () => {
    attempts++;
    if (process.env.WX_TEST_READER_NEGATIVE_CONTROL !== '1') throw new Error('reader-open-failed');
  });
  try {
    await f.host.start();
    const result = await f.host.call<{ accepted: boolean; epoch: WeatherEpoch; error?: string }>(
      'fixture.reader-failure',
      null,
    );
    assert.equal(attempts, 1);
    assert.equal(result.accepted, false);
    assert.equal(result.error, 'reader-open-failed');
    assert.equal(result.epoch.weatherDatabaseGenerationId, null);
    assert.equal(f.host.epoch.weatherDatabaseGenerationId, null);
    assert.equal(f.host.status().stopReason, 'initialization_failed');
    assert.equal(f.host.status().lifecycle, 'failed');
    assert.equal(f.host.status().restartAllowed, true);
    assert.deepEqual(f.failures, [
      { code: 'initialization_failed', generation: f.host.epoch.workerGeneration },
    ]);
  } finally {
    await f.close();
  }
});
