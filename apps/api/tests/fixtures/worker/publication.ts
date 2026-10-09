import { parentPort, threadId, workerData } from 'node:worker_threads';
import { initializeRoleDatabase } from '../../../src/database/roleDatabase.js';
import { WeatherTransport } from '../../../src/runtime/weatherTransport.js';
import { createAcquisitionRuntime } from '../../../src/runtime/createAcquisitionRuntime.js';
import type { AcquisitionWorkerData } from '../../../src/runtime/acquisitionWorker.js';
import { saveWarningCurrentSnapshot } from '../../../src/repositories/index.js';
import type { NotificationOutputHistoryInput } from '../../../src/repositories/types.js';
import type { WeatherEpoch } from '../../../src/runtime/weatherContracts.js';

const data = workerData as AcquisitionWorkerData;
let epoch = data.epoch;
let pauseDelay = 0;
const port = parentPort!;
const transport = new WeatherTransport(
  port,
  epoch.workerGeneration,
  async (method, value) => {
    if (method === 'runtime.close') {
      setImmediate(() => {
        void runtime.close().then(() => {
          db.close();
          transport.close();
          port.close();
        });
      });
      return null;
    }
    if (method === 'publication.pause') {
      const input = value as { token: string; expiresAt: string };
      await new Promise((resolve) => setTimeout(resolve, pauseDelay));
      return runtime.decisions.pause(input.token, input.expiresAt);
    }
    if (method === 'fixture.pause-delay') {
      pauseDelay = value as number;
      return null;
    }
    if (method === 'publication.release')
      return runtime.decisions.release((value as { token: string }).token);
    if (method === 'fixture.update') {
      const input = value as {
        snapshot: Parameters<typeof saveWarningCurrentSnapshot>[1];
        notification: NotificationOutputHistoryInput;
      };
      return runtime.decisions.runUpdate(
        { scopes: ['east'], initialWarningKeys: [], initialBosaiKeys: [] },
        () => {
          saveWarningCurrentSnapshot(db.connection, input.snapshot);
          runtime.decisions.recordSink.record([
            { ...input.notification, weatherDatabaseGenerationId: db.generation },
          ]);
        },
      );
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
  data.settings,
  epoch,
  data.checkpoint,
  transport,
);
runtime.initialization.setInitialFetchPhase('completed');
for (const venue of data.settings.venues) runtime.initialization.markVenueEvaluated(venue.venueId);
await transport.call('status', { epoch, report: runtime.status(), failureCode: null });
await transport.call('prepared', { epoch });
