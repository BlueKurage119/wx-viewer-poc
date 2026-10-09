import { parentPort } from 'node:worker_threads';

if (!parentPort) throw new Error('提供Worker fixture専用入口です');
const port = parentPort;
const post = port.postMessage.bind(port);
let paused = false;
let blockReads = false;
let blockSuspend = false;
const readIds = new Set<string>();
const suspendIds = new Set<string>();
port.postMessage = ((message: unknown, transfer?: readonly ArrayBuffer[]) => {
  if (
    paused &&
    message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'call' &&
    'method' in message &&
    message.method === 'status.report'
  )
    return;
  if (
    blockReads &&
    message &&
    typeof message === 'object' &&
    'type' in message &&
    (message.type === 'reply' || message.type === 'begin') &&
    'id' in message &&
    typeof message.id === 'string' &&
    readIds.has(message.id)
  )
    return;
  if (
    blockSuspend &&
    message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'reply' &&
    'id' in message &&
    typeof message.id === 'string' &&
    suspendIds.has(message.id)
  )
    return;
  post(message, transfer as ArrayBuffer[]);
}) as typeof port.postMessage;
port.on('message', (message: unknown) => {
  if (
    blockReads &&
    message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'call' &&
    'method' in message &&
    (message.method === 'read' || message.method === 'read.http') &&
    'id' in message &&
    typeof message.id === 'string'
  )
    readIds.add(message.id);
  if (
    blockSuspend &&
    message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'call' &&
    'method' in message &&
    message.method === 'reader.suspend' &&
    'id' in message &&
    typeof message.id === 'string'
  )
    suspendIds.add(message.id);
  if (!message || typeof message !== 'object' || !('test' in message)) return;
  if (message.test === 'pause-reports') {
    paused = true;
    post({ type: 'test', id: 'fixture-control', test: 'reports-paused' });
  } else if (message.test === 'resume-reports') {
    paused = false;
    post({ type: 'test', id: 'fixture-control', test: 'reports-resumed' });
  } else if (message.test === 'block-reads') {
    blockReads = true;
    post({ type: 'test', id: 'fixture-control', test: 'reads-blocked' });
  } else if (message.test === 'unblock-reads') {
    blockReads = false;
    readIds.clear();
    post({ type: 'test', id: 'fixture-control', test: 'reads-unblocked' });
  } else if (message.test === 'block-suspend') {
    blockSuspend = true;
    post({ type: 'test', id: 'fixture-control', test: 'suspend-blocked' });
  } else if (message.test === 'unblock-suspend') {
    blockSuspend = false;
    suspendIds.clear();
    post({ type: 'test', id: 'fixture-control', test: 'suspend-unblocked' });
  } else if (message.test === 'send-protocol-error') {
    post({ type: 'frame' });
  }
});

await import('../../../src/runtime/deliveryWorker.js');
