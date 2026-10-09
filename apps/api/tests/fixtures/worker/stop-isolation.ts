import { parentPort, threadId, workerData } from 'node:worker_threads';
import { initializeRoleDatabase } from '../../../src/database/roleDatabase.js';
import { WeatherTransport } from '../../../src/runtime/weatherTransport.js';
import { createAcquisitionRuntime } from '../../../src/runtime/createAcquisitionRuntime.js';
import type { AcquisitionWorkerData } from '../../../src/runtime/acquisitionWorker.js';
import type { WeatherEpoch } from '../../../src/runtime/weatherContracts.js';

const data = workerData as AcquisitionWorkerData;
let epoch = data.epoch;
const port = parentPort!;
const heldPauses: (() => void)[] = [];
const operations = new Map<string, { status: string; error: string | null }>();
let executions = 0;
let queries = 0;
const releasePauses = () => {
  for (const release of heldPauses.splice(0)) release();
};
const transport = new WeatherTransport(
  port,
  epoch.workerGeneration,
  async (method, value) => {
    if (method === 'runtime.close') {
      releasePauses();
      setImmediate(() => {
        void runtime.close().then(() => {
          db.close();
          transport.close();
          port.close();
        });
      });
      return null;
    }
    if (method === 'runtime.fail') return null;
    if (method === 'publication.pause') {
      const input = value as { token: string; expiresAt: string };
      await new Promise<void>((resolve) => heldPauses.push(resolve));
      return runtime.decisions.pause(input.token, input.expiresAt);
    }
    if (method === 'publication.release')
      return runtime.decisions.release((value as { token: string }).token);
    if (method === 'fixture.release-pauses') {
      releasePauses();
      return null;
    }
    if (method === 'fixture.operations')
      return { executions, queries, heldPauses: heldPauses.length };
    if (method === 'fetch.execute') {
      const input = value as { operationId: string; operation: 'stop' };
      executions++;
      await runtime.execute(input.operation);
      operations.set(input.operationId, { status: 'completed', error: null });
      return { status: 'in_progress', error: null };
    }
    if (method === 'operation.query') {
      queries++;
      return operations.get((value as { operationId: string }).operationId) ?? null;
    }
    throw new Error('invalid_request');
  },
  () => {},
);
await transport.call('runtime.accepting', { epoch, nonce: data.nonce, threadId });
const db = initializeRoleDatabase(data.pair, { ...data.owner, threadId });
epoch = await transport.call<WeatherEpoch>('database.ready', {
  epoch,
  generation: db.generation,
  schemaVersion: db.schemaVersion,
});
const runtime = createAcquisitionRuntime(
  db.connection,
  { ...data.settings, desiredRunning: false },
  epoch,
  data.checkpoint,
  transport,
);
await runtime.prepare();
runtime.initialization.setInitialFetchPhase('completed');
for (const venue of data.settings.venues) runtime.initialization.markVenueEvaluated(venue.venueId);
await transport.call('status', { epoch, report: runtime.status(), failureCode: null });
await transport.call('prepared', { epoch });
