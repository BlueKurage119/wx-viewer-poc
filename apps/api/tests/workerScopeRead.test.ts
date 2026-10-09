import type { MonitoringStatusResponse } from '@wx-viewer-poc/shared';
import type { WeatherReadKind, WeatherResponses } from '../src/runtime/weatherContracts.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import {
  createTemporaryTestDatabaseFixture,
  createTestServerDatabaseOptions,
  initializeTestDatabases,
} from './helpers/databasePair.js';
import { createTestPollingSchedule } from './helpers/pollingSchedule.js';
import { startServer } from '../src/server.js';
import {
  recordNotificationOutputHistory,
  saveWarningCurrentSnapshot,
} from '../src/repositories/index.js';
for (const granular of [false, true]) {
  for (const exit of [false, true]) {
    test(`実Workerの${granular ? '警報normal' : '会場全体'}保存後未完了scopeを${exit ? '異常終了後' : '実行中'}も通常APIへ公開しない`, async () => {
      const fixture = createTemporaryTestDatabaseFixture();
      const seed = initializeTestDatabases(fixture.config);
      const generation = seed.weatherDatabaseGenerationId;
      const now = '2026-10-09T03:00:00.000Z';
      const notification = (id: string, origin: 'weather' | 'system') => ({
        notificationId: id,
        category: 'warning',
        sourceType: 'warning_current',
        sourceVersion: id,
        targetAreaJson: JSON.stringify([
          { kind: 'area', codeType: 'jma_municipal_warning_area', code: '1310800', name: '江東区' },
        ]),
        occurredAt: now,
        detectedAt: now,
        changeType: 'new',
        ackRequired: false,
        summary: '試験通知',
        relatedRefsJson: '[]',
        origin,
        detectionContext: 'normal' as const,
        isTraining: false,
        messageDefinitionId: null,
        messageDefinitionVersion: null,
        weatherDatabaseGenerationId: origin === 'weather' ? generation : null,
      });
      function snapshot(version: string): Parameters<typeof saveWarningCurrentSnapshot>[1] {
        return {
          areaCode: '1310800',
          areaName: '江東区',
          metadata: {
            source: 'test',
            issuedAt: now,
            validAt: null,
            validFrom: null,
            validTo: null,
            fetchedAt: now,
            lastSuccessAt: now,
            availability: 'available',
            sourceVersion: version,
          },
          telegram: {
            controlStatus: 'normal',
            infoType: '発表',
            eventId: version,
            reportDateTime: now,
            controlDateTime: now,
          },
          items: [
            {
              sequence: 1,
              kindCode: '02',
              kindName: '暴風警報',
              kindStatus: '発表',
              lastKindCode: null,
              lastKindName: null,
              significancyCode: null,
              significancyName: null,
              warningLevel: null,
              attentionText: null,
              kindIssuedAt: now,
              sourceTelegram: 'VPWW55',
            },
          ],
        };
      }
      saveWarningCurrentSnapshot(seed.weather.connection, {
        ...snapshot('TRC-U1'),
        areaCode: '1311100',
        areaName: '大田区',
      });
      saveWarningCurrentSnapshot(seed.weather.connection, {
        ...snapshot('TRAINING-U1'),
        telegram: { ...snapshot('TRAINING-U1').telegram, controlStatus: 'training' },
      });
      recordNotificationOutputHistory(seed.retained.connection, notification('seed', 'system'));
      seed.retained.connection.exec('UPDATE notification_output_history SET id = 100');
      seed.close();
      const options = createTestServerDatabaseOptions(fixture.config);
      const delaySample = !granular && !exit;
      let sampleReleased = false;
      let queuedSample: unknown;
      let forwardSample: ((message: unknown) => void) | undefined;
      const releaseSample = () => {
        sampleReleased = true;
        if (queuedSample !== undefined) forwardSample?.(queuedSample);
        queuedSample = undefined;
      };
      const server = await startServer({
        ...options,
        port: 0,
        enablePolling: false,
        pollingSchedule: createTestPollingSchedule(),
        pollingServiceOptions: { clock: () => now },
        nowcastCacheRoot: join(fixture.config.databasePath, '..', 'nowcast'),
        kikikuruCacheRoot: join(fixture.config.databasePath, '..', 'kikikuru'),
        acquisitionWorkerEntry: new URL('./fixtures/worker/publication.ts', import.meta.url),
        onDeliveryWorkerCreated(worker) {
          if (!delaySample) return;
          const post = worker.postMessage.bind(worker);
          forwardSample = (message) => post(message);
          worker.postMessage = ((message: unknown, transfer?: readonly ArrayBuffer[]) => {
            const packet = message as {
              type?: string;
              method?: string;
              value?: { kind?: string; payload?: { terminal?: { id?: string } } };
            };
            if (
              packet.type === 'call' &&
              packet.method === 'read' &&
              packet.value?.kind === 'monitoring.sample' &&
              packet.value.payload?.terminal?.id === 'kkeagh01' &&
              !sampleReleased &&
              queuedSample === undefined
            ) {
              queuedSample = message;
              return;
            }
            post(message, transfer as ArrayBuffer[]);
          }) as typeof worker.postMessage;
        },
      });
      try {
        assert.equal((await server.weatherPrepared).status, 'ready');
        await server.acquisitionHost.call('fixture.update', {
          snapshot: snapshot('U1'),
          notification: notification('N1', 'weather'),
        });
        const base = `http://127.0.0.1:${server.port}`;
        const getWeather = async <K extends WeatherReadKind>(
          kind: K,
          terminalId = 'hkeagh01',
          controlStatus = 'normal',
        ) => {
          const response = await fetch(
            `${base}/api/weather/${kind}?terminalId=${terminalId}&controlStatus=${controlStatus}`,
          );
          assert.equal(response.status, 200);
          return response.json() as Promise<WeatherResponses[K]>;
        };
        // 提供Workerの監視sampleは端末ごとに非同期で届く。scope投影の前提を確認する。
        const monitoringUrl = `${base}/api/monitoring/status?terminalId=kkeagh01`;
        if (delaySample) {
          const heldDeadline = performance.now() + 5000;
          while (queuedSample === undefined) {
            assert.ok(performance.now() < heldDeadline, '監視sampleの保留を確認できません');
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          const unsampled = (await (await fetch(monitoringUrl)).json()) as MonitoringStatusResponse;
          assert.equal(unsampled.weatherSampleReceivedAt, null);
          assert.equal(unsampled.information.filter((item) => item.venueId === 'east').length, 8);
          assert.equal(
            unsampled.readErrors.filter(
              (item) => item.section === 'information' && item.venueId === 'east',
            ).length,
            0,
          );
          releaseSample();
        }
        const sampleDeadline = performance.now() + 10_000;
        for (;;) {
          const sampled = (await (await fetch(monitoringUrl)).json()) as MonitoringStatusResponse;
          if (
            sampled.weatherSampleReceivedAt &&
            sampled.information.filter((item) => item.venueId === 'east').length === 8
          )
            break;
          assert.ok(performance.now() < sampleDeadline, '監視sampleが期限内に届きません');
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.equal((await getWeather('warnings')).metadata.sourceVersion, 'U1');
        const unaffected = await getWeather('warnings', 'htrcph01');
        assert.equal(unaffected.metadata.sourceVersion, 'TRC-U1');
        const baseline = new Map<string, unknown>();
        for (const status of ['normal', 'training', 'test']) {
          for (const kind of [
            'warnings',
            'warning-timeseries',
            'area-timeseries',
            'amedas',
            'early-warning',
            'bulletins',
          ] as const)
            baseline.set(`${status}:${kind}`, await getWeather(kind, 'hkeagh01', status));
        }
        await server.acquisitionHost.call('fixture.incomplete', {
          snapshot: snapshot('U2'),
          exit,
          granular,
        });
        if (exit) {
          for (let i = 0; i < 200 && !server.acquisitionHost.status().exitConfirmed; i++)
            await new Promise((resolve) => setTimeout(resolve, 10));
          assert.equal(server.acquisitionHost.status().exitConfirmed, true);
        }
        assert.deepEqual(server.acquisitionHost.status().unknownScopes, [
          granular ? 'east|normal|warnings' : 'east',
        ]);
        const unavailable = {
          source: null,
          issuedAt: null,
          validAt: null,
          validFrom: null,
          validTo: null,
          fetchedAt: null,
          lastSuccessAt: null,
          availability: 'unavailable',
          sourceVersion: null,
        };
        for (const controlStatus of ['normal', 'training', 'test']) {
          for (const kind of [
            'warnings',
            'warning-timeseries',
            'area-timeseries',
            'amedas',
          ] as const) {
            const body = await getWeather(kind, 'hkeagh01', controlStatus);
            if (granular && (kind !== 'warnings' || controlStatus !== 'normal')) {
              assert.deepEqual(body, baseline.get(`${controlStatus}:${kind}`));
              continue;
            }
            assert.deepEqual(body.metadata, unavailable);
            assert.equal(body.data, null);
          }
          const early = await getWeather('early-warning', 'hkeagh01', controlStatus);
          if (granular) assert.deepEqual(early, baseline.get(`${controlStatus}:early-warning`));
          else
            for (const dataset of [early.near, early.far]) {
              assert.deepEqual(dataset.metadata, unavailable);
              assert.equal(dataset.data, null);
            }
          const bulletins = await getWeather('bulletins', 'hkeagh01', controlStatus);
          if (granular) assert.deepEqual(bulletins, baseline.get(`${controlStatus}:bulletins`));
          else {
            assert.equal(bulletins.availability, 'unavailable');
            assert.deepEqual(bulletins.bulletins, []);
          }
        }
        assert.deepEqual(await getWeather('warnings', 'htrcph01'), unaffected);
        const startup = await fetch(`${base}/api/notifications/startup`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            terminalId: 'hkeagh01',
            sessionId: '00000000-0000-4000-8000-000000000258',
            serverGenerationId: server.acquisitionHost.epoch.serverGenerationId,
          }),
        });
        assert.equal(((await startup.json()) as { status: string }).status, 'initializing');
        const monitoring = (await (await fetch(monitoringUrl)).json()) as MonitoringStatusResponse;
        const information = monitoring.information.filter(
          (item) => item.venueId === 'east' && (!granular || item.kind === 'warning'),
        );
        assert.equal(information.length, granular ? 1 : 8);
        assert.deepEqual(
          information.map((item: { availability: string; summaryCount: number | null }) => [
            item.availability,
            item.summaryCount,
          ]),
          Array.from({ length: granular ? 1 : 8 }, () => ['unavailable', null]),
        );
        assert.equal(
          monitoring.readErrors.filter(
            (item) => item.section === 'information' && item.venueId === 'east',
          ).length,
          granular ? 1 : 8,
        );
      } finally {
        releaseSample();
        await server.close();
        fixture.cleanup();
      }
    });
  }
}
