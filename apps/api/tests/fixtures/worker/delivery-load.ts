import { parentPort } from 'node:worker_threads';

if (!parentPort) throw new Error('提供Worker fixture専用入口です');
const port = parentPort;
port.on('message', (message: unknown) => {
  if (!message || typeof message !== 'object' || !('test' in message)) return;
  if (message.test !== 'encode-load') return;
  const bytes = 256 * 1024;
  const value = { payload: '気象'.repeat(bytes / 6) };
  const startedAt = Date.now();
  port.postMessage({ test: 'encode-load-started', startedAt, bytes });
  let iterations = 0;
  while (Date.now() - startedAt < 5000) {
    JSON.stringify(value);
    iterations++;
  }
  port.postMessage({ test: 'encode-load-ended', endedAt: Date.now(), bytes, iterations });
});

await import('../../../src/runtime/deliveryWorker.js');
