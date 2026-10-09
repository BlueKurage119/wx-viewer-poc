import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { initializeTestDatabases } from './helpers/databasePair.js';
import {
  eastVenueId,
  testTerminalRegistry,
  testVenueRegistry,
  trcVenueId,
} from './helpers/venueConfigPreload.js';
import { createTestPollingSchedule } from './helpers/pollingSchedule.js';
import { buildStoppedPollingStatus } from '../src/polling/index.js';
import {
  recordTelegramReception,
  upsertTelegramReceptionAdoption,
} from '../src/repositories/index.js';
import { createMonitoringStatusService } from '../src/monitoring/monitoringStatusService.js';

const migrationsDirectory = join(fileURLToPath(import.meta.url), '../../migrations');

function createDb() {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-warning-telegrams-'));
  const context = initializeTestDatabases({
    databasePath: join(directory, 'test.sqlite3'),
    migrationsDirectory,
  });
  return {
    connection: context.weather.connection,
    close: () => context.close(),
    cleanup: () => {
      context.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function insertTelegram(
  connection: ReturnType<typeof createDb>['connection'],
  index: number,
  adoptVenueId?: typeof eastVenueId | typeof trcVenueId,
): void {
  const xmlBody = `<Report><EventID>EVENT_${index}</EventID></Report>`;
  const contentHash = crypto.createHash('sha256').update(xmlBody).digest('hex');
  const reception = recordTelegramReception(connection, {
    fetchAttemptId: null,
    feedKind: 'extra',
    feedEntryId: `entry-${index}-${contentHash.slice(0, 8)}`,
    documentUrl: `https://example.com/xml/VPWW55_${index}.xml`,
    telegramType: 'VPWW55',
    title: '気象警報・注意報',
    controlStatus: 'normal',
    infoType: '発表',
    eventId: `EVENT_${index}`,
    serial: '1',
    controlDateTime: '2026-09-16T00:00:00Z',
    reportDateTime: '2026-09-16T00:00:00Z',
    targetDateTime: '2026-09-16T00:00:00Z',
    receivedAt: new Date(Date.now() + index * 1000).toISOString(),
    adoptions: [],
    rawBody: xmlBody,
    bodyBytes: Buffer.byteLength(xmlBody, 'utf-8'),
    contentHash,
    areas: [],
  });
  if (adoptVenueId) {
    upsertTelegramReceptionAdoption(connection, reception.id, {
      venueId: adoptVenueId,
      adoptionResult: '警報・注意報として解析済み',
      adoptionReason: null,
      adoptionDecidedAt: '2026-09-16T00:01:00Z',
    });
  }
}

function createService(connection: ReturnType<typeof createDb>['connection']) {
  const now = '2026-09-16T03:00:00.000Z';
  return createMonitoringStatusService({
    getTileUpstreamAccess: () => ({ allowed: false, reason: 'disabled', nextAllowedAt: null }),
    connection,
    venueRegistry: testVenueRegistry,
    terminalRegistry: testTerminalRegistry,
    scheduler: {
      getStatus: () => buildStoppedPollingStatus(new Date(now), createTestPollingSchedule()),
      isRunningNow: () => false,
    },
    xmlPollingService: {
      getStatus: () => ({ initialFetch: { phase: 'completed', result: null } }),
    },
    fetchHealthMonitor: { getLastAggregate: () => null },
    startupInitialization: {
      getStatus: () => ({
        initialFetchPhase: 'completed',
        preparationFailures: [],
        evaluatedVenueIds: new Set([eastVenueId, trcVenueId]),
      }),
    },
    // 件数だけを検証するため、情報の読取は失敗として扱わせる。
    weatherApi: {} as never,
    nowcastApi: {} as never,
    kikikuruApi: {} as never,
    fetchHealthConfig: createTestPollingSchedule().fetchHealth,
    serverGenerationId: 'generation-1',
    serverStartedAt: '2026-09-16T00:00:00.000Z',
    now: () => now,
  });
}

function terminalFor(venueId: string) {
  const terminal = testTerminalRegistry.listTerminals().find((item) => item.venueId === venueId);
  assert.ok(terminal);
  return terminal;
}

test('未判定の警報系電文件数: 0件・3件・会場違いを監視応答へ毎回含める', () => {
  const { connection, cleanup } = createDb();
  try {
    const service = createService(connection);
    assert.deepEqual(service.getStatus(terminalFor(eastVenueId)).warningTelegrams, {
      venueId: eastVenueId,
      pendingCount: 0,
    });

    insertTelegram(connection, 1);
    insertTelegram(connection, 2);
    insertTelegram(connection, 3);
    assert.equal(service.getStatus(terminalFor(eastVenueId)).warningTelegrams?.pendingCount, 3);
    assert.equal(service.getStatus(terminalFor(trcVenueId)).warningTelegrams?.pendingCount, 3);

    insertTelegram(connection, 4, eastVenueId);
    const east = service.getStatus(terminalFor(eastVenueId)).warningTelegrams;
    const trc = service.getStatus(terminalFor(trcVenueId)).warningTelegrams;
    assert.deepEqual(east, { venueId: eastVenueId, pendingCount: 3 });
    assert.deepEqual(trc, { venueId: trcVenueId, pendingCount: 4 });
  } finally {
    cleanup();
  }
});

test('未判定件数の読取失敗は null とし、readErrors に新しい区分を足さない', () => {
  const { connection, close, cleanup } = createDb();
  try {
    const service = createService(connection);
    close();
    const response = service.getStatus(terminalFor(eastVenueId));
    assert.equal(response.warningTelegrams, null);
    for (const error of response.readErrors) {
      assert.ok(['recent_adoptions', 'information', 'tiles'].includes(error.section));
    }
  } finally {
    cleanup();
  }
});
