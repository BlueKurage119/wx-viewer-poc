import { createRequire } from 'node:module';
import { appendFileSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { workerData } from 'node:worker_threads';
import type { AcquisitionWorkerData } from '../../../src/runtime/acquisitionWorker.js';

const data = workerData as AcquisitionWorkerData;
const require = createRequire(import.meta.url);
const binding = require(join(dirname(require.resolve('better-sqlite3')), 'binding.js')) as {
  getBinding: () => { Database: new (...args: unknown[]) => object };
};
const addon = binding.getBinding();
const OriginalDatabase = addon.Database;
const marker = `${data.settings.nowcastCacheRoot}.open-fault`;
addon.Database = new Proxy(OriginalDatabase, {
  construct(target, args) {
    if (
      basename(String(args[0])) === basename(data.pair.weather.databasePath) &&
      existsSync(marker)
    ) {
      appendFileSync(`${marker}.observed`, 'sqlite-open-throw\n');
      throw Object.assign(new Error('固定fixtureのSQLite open失敗'), { code: 'SQLITE_CANTOPEN' });
    }
    return Reflect.construct(target, args);
  },
});
await import('../../../src/runtime/acquisitionWorker.js');
