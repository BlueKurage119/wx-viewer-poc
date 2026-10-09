import { parentPort } from 'node:worker_threads';
import { DOMParser } from '@xmldom/xmldom';
import '../../../src/runtime/acquisitionWorker.js';
const telegram = `<Report><Body>${'<Item><Area>固定負荷資料</Area><Value>123</Value></Item>'.repeat(500)}</Body></Report>`;
parentPort!.on('message', (message: { test?: string }) => {
  if (message.test !== 'xml-load') return;
  const started = Date.now();
  parentPort!.postMessage({ test: 'load-started', bytes: Buffer.byteLength(telegram) });
  let iterations = 0;
  while (Date.now() - started < 5000) {
    new DOMParser().parseFromString(telegram, 'text/xml');
    iterations++;
  }
  parentPort!.postMessage({ test: 'load-ended', iterations });
});
