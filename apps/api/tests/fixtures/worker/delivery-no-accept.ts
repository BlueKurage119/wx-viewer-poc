import { parentPort } from 'node:worker_threads';

if (!parentPort) throw new Error('提供Worker fixture専用入口です');
parentPort.on('message', () => {
  // 意図的に受付を返さない。
});
