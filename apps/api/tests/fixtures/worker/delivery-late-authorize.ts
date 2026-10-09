import { parentPort } from 'node:worker_threads';

if (!parentPort) throw new Error('提供Worker fixture専用入口です');
await new Promise((resolve) => setTimeout(resolve, 5200));
parentPort.postMessage({ type: 'test', id: 'fixture-control', test: 'late-entry' });
await import('../../../src/runtime/deliveryWorker.js');
