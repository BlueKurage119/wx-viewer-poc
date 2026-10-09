import { parentPort, workerData, threadId } from 'node:worker_threads';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { register } from 'tsx/esm/api';
register();
const { WeatherTransport } = await import('../../../src/runtime/weatherTransport.ts');
const settings = workerData.settings;
let epoch = workerData.epoch;
const originalEpoch = structuredClone(epoch);
const log = (event, extra = {}) =>
  appendFileSync(
    settings.fixtureEvents,
    `${JSON.stringify({ event, generation: epoch.workerGeneration, threadId, ...extra })}\n`,
  );
log('spawn', { desiredRunning: settings.desiredRunning });
process.on('exit', () => log('exit'));
let heartbeat;
let transport;
const operations = new Map();
const operationGates = new Map();
const status = () =>
  transport.call('status', { epoch, report: null, failureCode: null }).catch(() => {});
transport = new WeatherTransport(
  parentPort,
  epoch.workerGeneration,
  async (method, value) => {
    if (method === 'runtime.close') {
      log('close');
      clearInterval(heartbeat);
      setTimeout(() => process.exit(0), 20);
      return null;
    }
    if (method === 'fixture.info')
      return { threadId, epoch, desiredRunning: settings.desiredRunning };
    if (method === 'fixture.echo') return value;
    if (method === 'fixture.release-operation') {
      operationGates.get(value.operationId)?.();
      return null;
    }
    if (method === 'fetch.execute') {
      const { operationId, operation } = value;
      log('execute-received', { operationId, operation });
      if (operationId.startsWith('reject-late')) {
        await new Promise((resolve) => operationGates.set(operationId, resolve));
        throw new Error('busy');
      }
      if (operationId.startsWith('reject')) throw new Error('busy');
      if (!operations.has(operationId)) {
        log('operation-executed', { operationId, operation });
        operations.set(operationId, { status: 'completed', error: null });
      }
      if (operationId.startsWith('exit-before-ack')) {
        setTimeout(() => process.exit(1), 30);
        return new Promise(() => {});
      }
      if (operationId.startsWith('lost-accept-exit')) setTimeout(() => process.exit(1), 5200);
      if (operationId.startsWith('lost-accept')) return new Promise(() => {});
      if (operationId.startsWith('late-accept'))
        await new Promise((resolve) => operationGates.set(operationId, resolve));
      return { status: 'in_progress', error: null };
    }
    if (method === 'operation.query') {
      const { operationId } = value;
      log('operation-query', { operationId });
      if (operationId.startsWith('hold-query')) {
        await new Promise((resolve) => operationGates.set(operationId, resolve));
      }
      if (operationId.startsWith('query-busy')) throw new Error('busy');
      if (operationId.startsWith('query-not-ready')) throw new Error('not_ready');
      if (operationId.startsWith('lost-accept-exit')) return new Promise(() => {});
      if (operationId.startsWith('lost-complete')) return new Promise(() => {});
      if (operationId.startsWith('query-unknown')) return null;
      return operations.get(operationId) ?? null;
    }
    if (method === 'fixture.wait') {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return true;
    }
    if (method === 'fixture.exit') {
      setTimeout(() => process.exit(1), 30);
      return null;
    }
    if (method === 'fixture.throw') {
      setTimeout(() => {
        throw new Error('固定fixtureの未捕捉例外');
      }, 30);
      return null;
    }
    if (method === 'fixture.protocol') {
      setTimeout(
        () => parentPort.postMessage({ generation: epoch.workerGeneration, type: 'invalid' }),
        30,
      );
      return null;
    }
    if (method === 'fixture.block') {
      setTimeout(() => {
        log('block-start');
        const until = performance.now() + value.duration;
        let processed = 0;
        while (performance.now() < until) {
          JSON.parse('{"fixture":"同期処理","values":[1,2,3,4]}');
          processed++;
        }
        log('block-end', { processed });
      }, 50);
      return null;
    }
    if (method === 'fixture.prepared') {
      await transport.call('prepared', { epoch });
      return null;
    }
    if (method === 'fixture.database') {
      epoch = await transport.call('database.ready', {
        epoch,
        generation: 'fixture-db',
        schemaVersion: 1,
      });
      await status();
      return epoch;
    }
    if (method === 'fixture.reader-failure') {
      try {
        epoch = await transport.call('database.ready', {
          epoch,
          generation: 'fixture-db',
          schemaVersion: 1,
        });
        return { accepted: true, epoch };
      } catch (error) {
        await transport.call('initialization.failed', { epoch, code: 'initialization_failed' });
        return { accepted: false, epoch, error: error.message };
      }
    }
    if (method === 'fixture.old-status') {
      try {
        await transport.call('status', { epoch: originalEpoch, report: null, failureCode: null });
        return 'accepted';
      } catch (error) {
        return error.message;
      }
    }
    if (method === 'fixture.early-unit') {
      const proposed = { ...epoch, weatherDatabaseGenerationId: 'fixture-db' };
      void transport
        .call('database.ready', { epoch, generation: 'fixture-db', schemaVersion: 1 })
        .then((accepted) => {
          epoch = accepted;
        })
        .catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 50));
      try {
        await transport.call('update.begin', {
          epoch: proposed,
          unitId: 'early-unit',
          beforeRevision: 0,
          scopes: ['east'],
          initialWarningKeys: [],
          initialBosaiKeys: [],
        });
        return 'accepted';
      } catch (error) {
        return error.message;
      }
    }
    throw new Error('invalid_request');
  },
  (code) => log('transport-failure', { code }),
);

async function accept() {
  try {
    await transport.call('runtime.accepting', { nonce: workerData.nonce, epoch });
    const lock = `${workerData.pair.weather.databasePath}.writer-lock`;
    mkdirSync(lock);
    const owner = { ...workerData.owner, threadId };
    const stored =
      settings.fixtureMode === 'incomplete-owner'
        ? { pid: owner.pid }
        : settings.fixtureMode === 'wrong-owner'
          ? { ...owner, token: 'other-token' }
          : owner;
    writeFileSync(join(lock, 'owner.json'), JSON.stringify(stored));
    log('lease');
    await status();
    heartbeat = setInterval(status, 200);
  } catch (error) {
    log('accept-rejected', { code: error.message });
  }
}
if (settings.fixtureMode === 'late-accept') setTimeout(accept, 5_300);
else await accept();
