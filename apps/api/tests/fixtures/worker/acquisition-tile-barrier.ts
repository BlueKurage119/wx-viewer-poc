import { parentPort } from 'node:worker_threads';

if (!parentPort) throw new Error('取得Worker試験専用入口です');
const port = parentPort;
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const waiting = new Set<() => void>();
let autoRelease = false;
let tileFetches = 0;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (!/\/10\/([2-9])\/\1\.png$/.test(url)) return new Response('', { status: 503 });
  tileFetches++;
  port.postMessage({ test: 'tile-ensure-entered', tileFetches });
  if (autoRelease)
    return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
  return new Promise<Response>((resolve, reject) => {
    const release = () =>
      resolve(new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }));
    waiting.add(release);
    init?.signal?.addEventListener(
      'abort',
      () => {
        waiting.delete(release);
        reject(init.signal?.reason);
      },
      { once: true },
    );
  });
};
port.on('message', (message: { test?: string }) => {
  if (message.test === 'release-tile' || message.test === 'release-all') {
    if (message.test === 'release-all') autoRelease = true;
    for (const release of waiting) release();
    waiting.clear();
    port.postMessage({ test: 'tile-ensure-released', tileFetches });
  }
});
await import('../../../src/runtime/acquisitionWorker.js');
