import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { AcquisitionWorkerHost } from '../../src/runtime/acquisitionWorkerHost.js';
import { openDatabase } from '../../src/database/connection.js';
import { validatePollingScheduleConfig } from '../../src/config/pollingSchedule.js';
import type { AcquisitionSettings } from '../../src/runtime/createAcquisitionRuntime.js';
import { testVenueRegistry } from './venueConfigPreload.js';

type Event = {
  event: string;
  generation: string;
  threadId: number;
  desiredRunning?: boolean;
  code?: string;
  processed?: number;
  operationId?: string;
  operation?: string;
};
export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export async function until(predicate: () => boolean, timeout = 3_000) {
  const end = performance.now() + timeout;
  while (!predicate()) {
    if (performance.now() >= end) assert.fail('観測期限を超過しました');
    await delay(20);
  }
}
export function setup(mode = 'normal', databaseReady: () => Promise<void> = async () => {}) {
  const directory = mkdtempSync(join(tmpdir(), 'wx-worker-host-'));
  const eventsFile = join(directory, 'events.jsonl');
  const connection = openDatabase(join(directory, 'retained.sqlite'));
  const failures: { code: string; generation: string }[] = [];
  const events = (): Event[] =>
    existsSync(eventsFile)
      ? readFileSync(eventsFile, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Event)
      : [];
  const settings: AcquisitionSettings & { fixtureMode: string; fixtureEvents: string } = {
    venues: testVenueRegistry.listVenues(),
    venueGeneration: 'fixture',
    schedule: validatePollingScheduleConfig(
      yaml.load(readFileSync(new URL('../../../../config/polling.yaml', import.meta.url), 'utf8')),
    ),
    enablePolling: false,
    desiredRunning: false,
    serverStartedAt: '2026-10-09T00:00:00.000Z',
    nowcastCacheRoot: join(directory, 'nowcast'),
    kikikuruCacheRoot: join(directory, 'kikikuru'),
    fixtureMode: mode,
    fixtureEvents: eventsFile,
  };
  const pair = {
    weather: {
      role: 'weather' as const,
      databasePath: join(directory, 'weather.sqlite'),
      migrationsDirectory: join(directory, 'weather-migrations'),
    },
    retained: {
      role: 'retained' as const,
      databasePath: join(directory, 'retained.sqlite'),
      migrationsDirectory: join(directory, 'retained-migrations'),
    },
  };
  let readerCloses = 0;
  let reports = 0;
  const host = new AcquisitionWorkerHost({
    pair,
    settings,
    serverGenerationId: 'fixture-server',
    retainedConnection: connection,
    databaseReady,
    closeReader: async () => {
      readerCloses++;
      assert.equal(events().at(-1)?.event, 'exit');
    },
    onReport: () => reports++,
    onFailure: (code, generation) => failures.push({ code, generation }),
    workerEntry: new URL('../fixtures/acquisition-worker/host-fixture.mjs', import.meta.url),
  });
  return {
    host,
    failures,
    events,
    directory,
    lock: `${pair.weather.databasePath}.writer-lock`,
    readerCloses: () => readerCloses,
    reports: () => reports,
    async close() {
      try {
        await host.close();
      } finally {
        connection.close();
        rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}
