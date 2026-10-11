import { parentPort } from 'node:worker_threads';
import { createRealPollFixture } from '../../issue260RealPollFixture.mjs';

const fixture = createRealPollFixture(Number(process.env.BENCH_FIXED_ITEMS));
globalThis.fetch = fixture.fetchFn;
parentPort!.on('message', (message: { test?: string }) => {
  if (message.test !== 'issue260-real-poll-activate') return;
  fixture.activate();
  parentPort!.postMessage({ test: 'issue260-real-poll-active' });
});

await import('../../../src/runtime/acquisitionWorker.js');
