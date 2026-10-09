import { parentPort } from 'node:worker_threads';

if (!parentPort) throw new Error('提供Worker fixture専用入口です');
const port = parentPort;
const post = port.postMessage.bind(port);
let hold = false;
const readIds = new Set<string>();
const held: { message: unknown; transfer?: readonly ArrayBuffer[] }[] = [];
port.postMessage = ((message: unknown, transfer?: readonly ArrayBuffer[]) => {
  if (
    hold &&
    message &&
    typeof message === 'object' &&
    'id' in message &&
    typeof message.id === 'string' &&
    readIds.has(message.id)
  ) {
    held.push({ message, transfer });
    post({ type: 'test', id: 'fixture-control', test: 'read-held' });
    return;
  }
  post(message, transfer as ArrayBuffer[]);
}) as typeof port.postMessage;
port.on('message', (message: unknown) => {
  if (!message || typeof message !== 'object') return;
  if (
    hold &&
    'type' in message &&
    message.type === 'call' &&
    'method' in message &&
    (message.method === 'read' || message.method === 'read.http') &&
    'id' in message &&
    typeof message.id === 'string'
  )
    readIds.add(message.id);
  if (!('test' in message)) return;
  if (message.test === 'hold-reads') {
    hold = true;
    post({ type: 'test', id: 'fixture-control', test: 'reads-held' });
  } else if (message.test === 'release-reads') {
    hold = false;
    for (const item of held.splice(0)) post(item.message, item.transfer as ArrayBuffer[]);
    readIds.clear();
    post({ type: 'test', id: 'fixture-control', test: 'reads-released' });
  }
});

await import('../../../src/runtime/deliveryWorker.js');
