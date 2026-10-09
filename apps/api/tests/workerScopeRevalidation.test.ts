import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { existsSync, writeFileSync } from 'node:fs';
import {
  createTemporaryTestDatabaseFixture,
  createTestServerDatabaseOptions,
  initializeTestDatabases,
} from './helpers/databasePair.js';
import { testVenueRegistry, eastVenueId } from './helpers/venueConfigPreload.js';
import { until } from './helpers/acquisitionWorkerHostFixture.js';
import { createTestPollingSchedule } from './helpers/pollingSchedule.js';
import { AcquisitionWorkerHost } from '../src/runtime/acquisitionWorkerHost.js';
import { initializeRoleDatabase, openWeatherReader } from '../src/database/roleDatabase.js';
import { recordTelegramReception, findWarningCurrentSnapshot } from '../src/repositories/index.js';
import { applyWarningCurrentReception } from '../src/polling/jmaWarningCurrentProcessor.js';
import { parseWarningTelegram } from '../src/polling/jmaWarningTelegramParser.js';
import { resolveVenueWarningContext } from '../src/venueForecastTargets.js';
const venue = resolveVenueWarningContext(testVenueRegistry, eastVenueId);
function buildXml(input: {
  telegramType: string;
  reportDateTime: string;
  kindsXml: string;
  controlStatus?: 'normal' | 'training' | 'test';
  infoType?: string;
  areaCode?: string;
  areaName?: string;
}): string {
  const status =
    input.controlStatus === 'training' ? '訓練' : input.controlStatus === 'test' ? '試験' : '通常';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
  <Control><Title>気象警報・注意報</Title><DateTime>${input.reportDateTime}</DateTime><Status>${status}</Status><EditorialOffice>気象庁本庁</EditorialOffice><PublishingOffice>気象庁</PublishingOffice></Control>
  <Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>東京都気象警報・注意報</Title><ReportDateTime>${input.reportDateTime}</ReportDateTime><TargetDateTime>${input.reportDateTime}</TargetDateTime><EventID>EVENT1</EventID><InfoType>${input.infoType ?? '発表'}</InfoType><Serial>1</Serial><InfoKind>気象警報・注意報</InfoKind><InfoKindVersion>1.0_1</InfoKindVersion><Headline><Text>警報・注意報</Text></Headline></Head>
  <Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/"><Warning type="気象警報・注意報（市町村等）"><Item><Area><Name>${input.areaName ?? '江東区'}</Name><Code>${input.areaCode ?? '1310800'}</Code></Area>${input.kindsXml}</Item></Warning></Body>
</Report>`;
}

function save(input: {
  connection: Database.Database;
  telegramType: string;
  reportDateTime: string;
  kindsXml: string;
  controlStatus?: 'normal' | 'training' | 'test';
  infoType?: string;
  apply?: boolean;
  urlSuffix?: string;
  areaCode?: string;
  areaName?: string;
  expectParse?: boolean;
}) {
  const rawBody = buildXml(input);
  const contentHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  const reception = recordTelegramReception(input.connection, {
    fetchAttemptId: null,
    feedKind: 'extra',
    feedEntryId: `entry-${contentHash.slice(0, 12)}-${input.urlSuffix ?? ''}`,
    documentUrl: `https://example.com/${input.telegramType}-${contentHash}-${input.urlSuffix ?? ''}.xml`,
    telegramType: input.telegramType,
    title: '東京都気象警報・注意報',
    controlStatus: input.controlStatus ?? 'normal',
    infoType: input.infoType ?? '発表',
    eventId: 'EVENT1',
    serial: '1',
    controlDateTime: input.reportDateTime,
    reportDateTime: input.reportDateTime,
    targetDateTime: input.reportDateTime,
    receivedAt: input.reportDateTime,
    adoptions: [],
    rawBody,
    bodyBytes: Buffer.byteLength(rawBody),
    contentHash,
    areas: [
      {
        areaCode: input.areaCode ?? '1310800',
        areaName: input.areaName ?? '江東区',
        codeType: '気象警報・注意報（市町村等）',
        sequence: 1,
      },
    ],
  });
  const parsed = parseWarningTelegram(rawBody, reception, venue.targetArea);
  if (input.expectParse !== false) assert.equal(parsed.ok, true);
  if (parsed.ok && input.apply !== false) {
    applyWarningCurrentReception(input.connection, reception, parsed.value, venue.targetArea);
  }
  return reception;
}

for (const readFailure of [false, true]) {
  test(`実Workerの更新ACK喪失後、停止意図の再開でローカル検証成功scopeだけ解除する（読取障害=${readFailure}）`, async () => {
    const fixture = createTemporaryTestDatabaseFixture();
    const options = createTestServerDatabaseOptions(fixture.config);
    const seeded = initializeTestDatabases(fixture.config);
    save({
      connection: seeded.weather.connection,
      telegramType: 'VPWS50',
      reportDateTime: '2026-10-09T01:00:00.000Z',
      kindsXml:
        '<Kind><Name>大雨注意報</Name><Code>10</Code><Status>発表</Status><DateTime>2026-10-09T01:00:00Z</DateTime></Kind>',
    });
    const expected = findWarningCurrentSnapshot(seeded.weather.connection, '1310800', 'normal');
    seeded.close();
    const retained = initializeRoleDatabase(options.config, {
      pid: process.pid,
      role: 'retained',
      token: 'scope-test',
      startedAt: new Date().toISOString(),
      serverGenerationId: 'scope-test',
      workerGeneration: null,
      threadId: null,
    });
    let reader: Database.Database | null = null;
    let dropped = false;
    let spawnCount = 0;
    let preparedCount = 0;
    const host = new AcquisitionWorkerHost({
      pair: options.config,
      settings: {
        venues: testVenueRegistry.listVenues(),
        venueGeneration: testVenueRegistry.generation,
        schedule: createTestPollingSchedule(),
        enablePolling: true,
        desiredRunning: false,
        serverStartedAt: new Date().toISOString(),
        nowcastCacheRoot: options.nowcastCacheRoot!,
        kikikuruCacheRoot: options.kikikuruCacheRoot!,
      },
      serverGenerationId: 'scope-test',
      retainedConnection: retained.connection,
      databaseReady: async (generation, version) => {
        reader = openWeatherReader(options.config.weather, generation, version);
      },
      closeReader: async () => {
        reader?.close();
        reader = null;
      },
      onReport() {},
      onFailure() {},
      workerEntry: new URL('./fixtures/acquisition-worker/scope-revalidation.ts', import.meta.url),
      onWorkerCreated(worker) {
        spawnCount++;
        worker.on('message', (message) => {
          if (!message.bytes) return;
          const packet = JSON.parse(Buffer.from(message.bytes).toString());
          if (packet.kind === 'call' && packet.method === 'prepared') preparedCount++;
          if (dropped) return;
          if (
            packet.kind === 'call' &&
            packet.method === 'update.begin' &&
            packet.value.scopes.includes('east|normal|warnings')
          ) {
            // 未完了の2情報種を同時に検証し、preparedによる全解除を検出する。
            packet.value.scopes.push('east|normal|early-warning');
            message.bytes = Buffer.from(JSON.stringify(packet));
          }
        });
        const post = worker.postMessage.bind(worker);
        worker.postMessage = (message) => {
          if (!dropped && message.bytes) {
            const packet = JSON.parse(Buffer.from(message.bytes).toString());
            if (
              packet.kind === 'reply' &&
              packet.method === 'update.begin' &&
              host.decisions.pendingUnit?.scopes.includes('east|normal|warnings')
            ) {
              dropped = true;
              return;
            }
          }
          post(message);
        };
      },
    });
    try {
      await host.start();
      assert.equal((await host.weatherPrepared).status, 'failed');
      await until(() => host.status().failureCode === 'handshake_timeout', 8000);
      assert.equal(dropped, true);
      assert.deepEqual(host.status().unknownScopes, [
        'east|normal|warnings',
        'east|normal|early-warning',
      ]);
      assert.equal(spawnCount, 1);
      if (readFailure) writeFileSync(`${options.nowcastCacheRoot}.revalidation.fault`, 'enabled');
      await host.restart();
      await until(() => preparedCount === 1, 5000);
      assert.deepEqual(
        host.status().unknownScopes,
        readFailure ? ['east|normal|early-warning'] : [],
      );
      assert.equal(host.report?.locallyValidatedScopes.includes('east|normal|warnings'), true);
      assert.equal(
        host.report?.locallyValidatedScopes.includes('east|normal|early-warning'),
        !readFailure,
      );
      assert.equal(host.report?.locallyValidatedScopes.includes('east|training|warnings'), true);
      assert.equal(host.report?.locallyValidatedScopes.includes('trc|normal|warnings'), true);
      assert.equal(host.report?.locallyValidatedScopes.includes('trc|training|warnings'), true);
      assert.equal(findWarningCurrentSnapshot(reader!, '1310800', 'training'), null);
      assert.equal(findWarningCurrentSnapshot(reader!, '1311100', 'normal'), null);
      assert.equal(host.desiredRunning, false);
      assert.equal(host.report?.running, false);
      assert.equal(host.report?.initialization.initialFetchPhase, 'not_started');
      assert.deepEqual(host.report?.initialization.evaluatedVenueIds, []);
      assert.equal(existsSync(`${options.nowcastCacheRoot}.revalidation.fetch`), false);
      assert.equal(existsSync(`${options.nowcastCacheRoot}.revalidation.observed`), readFailure);
      assert.deepEqual(findWarningCurrentSnapshot(reader!, '1310800', 'normal'), expected);
      assert.deepEqual(
        retained.connection
          .prepare(
            "SELECT notification_id FROM notification_output_history WHERE origin = 'weather'",
          )
          .all(),
        [],
      );
      assert.deepEqual(host.decisions.snapshot().warningDoneKeys, ['1310800|normal']);
      assert.equal(spawnCount, 2);
    } finally {
      await host.close();
      retained.close();
      fixture.cleanup();
    }
  });
}
