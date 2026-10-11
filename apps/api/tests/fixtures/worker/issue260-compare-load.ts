import { parentPort } from 'node:worker_threads';
import { DOMParser } from '@xmldom/xmldom';
import '../../../src/runtime/acquisitionWorker.js';

const telegram = `<Report><Body>${'<Item><Area>固定負荷資料</Area><Value>123</Value></Item>'.repeat(500)}</Body></Report>`;

parentPort!.on('message', (message: { test?: string; kind?: string; count?: number }) => {
  if (message.test !== 'issue260-load' || message.kind !== 'parser') return;
  const count = message.count;
  if (!Number.isInteger(count) || count === undefined || count < 1 || count > 1000) {
    parentPort!.postMessage({ test: 'load-failed', error: '解析回数が不正です' });
    return;
  }
  const startedAt = Date.now();
  const cpuStart = process.threadCpuUsage();
  parentPort!.postMessage({ test: 'load-started', kind: 'parser' });
  for (let i = 0; i < count; i++) new DOMParser().parseFromString(telegram, 'text/xml');
  const cpu = process.threadCpuUsage(cpuStart);
  parentPort!.postMessage({
    test: 'load-ended',
    kind: 'parser',
    items: count,
    elapsedMs: Date.now() - startedAt,
    cpuMs: (cpu.user + cpu.system) / 1000,
  });
});
