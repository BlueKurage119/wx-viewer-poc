import { createVenueRegistry } from '@wx-viewer-poc/shared';
import { telegramWeatherScopes } from '../../../src/runtime/weatherReadScope.js';
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
    if (method === 'fixture.invalidate-scope') {
      report.locallyValidatedScopes = report.locallyValidatedScopes.filter(
        (scope) => scope !== value,
      );
      await transport.call('status', { epoch, report, failureCode: null });
      return null;
    }
    if (method === 'fixture.pause-delay') {
      pauseDelay = value as number;
      return null;
    }
    if (method === 'publication.release')
      return runtime.decisions.release((value as { token: string }).token);
    if (method === 'fixture.incomplete') {
      const input = value as {
        snapshot: Parameters<typeof saveWarningCurrentSnapshot>[1];
        exit: boolean;
        granular?: boolean;
      };
      await transport.call('update.begin', {
        unitId: 'incomplete',
        epoch,
        beforeRevision: 1,
        scopes: input.granular
          ? telegramWeatherScopes(
              createVenueRegistry(data.settings.venues, data.settings.venueGeneration),
              {
                telegramType: 'VPWW55',
                controlStatus: 'normal',
                areas: [
                  {
                    sequence: 1,
                    areaCode: '1310800',
                    areaName: '江東区',
                    codeType: '気象・地震・火山情報／市町村等',
                  },
                ],
              },
            )
          : ['east'],
        initialWarningKeys: [],
        initialBosaiKeys: [],
      });
      saveWarningCurrentSnapshot(db.connection, input.snapshot);
      if (input.exit) setTimeout(() => process.exit(1), 100);
      return null;
    }
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
// このfixtureは準備処理を省き、公開境界用に注入した整合済みsnapshotのscopeを明示する。
const report = runtime.status();
report.locallyValidatedScopes = data.settings.venues.flatMap((venue) =>
  ['normal', 'training', 'test'].flatMap((status) =>
    [
      'warnings',
      'warning-timeseries',
      'early-warning',
      'area-timeseries',
      'amedas',
      'bulletins',
    ].map((kind) => `${venue.venueId}|${status}|${kind}`),
  ),
);
await transport.call('status', { epoch, report, failureCode: null });
await transport.call('prepared', { epoch });
