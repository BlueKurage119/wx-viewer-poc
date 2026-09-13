import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import { initializeDatabase, type DatabaseConnection } from '../src/database/index.js';
import {
  listNotificationOutputHistory,
  recordTelegramReception,
  type TelegramReception,
} from '../src/repositories/index.js';
import { rebuildWarningCurrentFromReceptions } from '../src/polling/jmaWarningCurrentProcessor.js';
import { resolveVenueWarningContext } from '../src/venueForecastTargets.js';
import {
  InitialWarningNotificationTracker,
  emitInitialWarningNotifications,
  type WarningNotificationEmitDeps,
} from '../src/notifications/index.js';
import { FetchHealthStateStore } from '../src/monitoring/fetchHealthStateStore.js';
import {
  aggregateFetchHealth,
  type FetchSourceHealthResult,
} from '../src/monitoring/fetchHealthEvaluator.js';
import {
  MONITORED_FETCH_SOURCES,
  type MonitoredFetchSourceId,
} from '../src/monitoring/fetchHealthSources.js';
import { emitFetchHealthNotification } from '../src/notifications/fetchHealthNotificationEmitter.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');
const EAST_VENUE = resolveVenueWarningContext('east'); // 江東区: 1310800

function createTempDb(): {
  connection: DatabaseConnection;
  cleanup: () => void;
} {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-origin-pipeline-test-'));
  const databasePath = join(directory, 'test.sqlite3');
  const context = initializeDatabase({ databasePath, migrationsDirectory });
  return {
    connection: context.connection,
    cleanup: () => {
      context.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function buildXml(
  telegramType: string,
  reportDateTime: string,
  kindsXml: string,
  options?: {
    readonly controlDateTime?: string;
    readonly controlStatus?: string;
    readonly infoType?: string;
    readonly areaCode?: string;
    readonly areaName?: string;
  },
): string {
  const controlStatus = options?.controlStatus ?? '通常';
  const infoType = options?.infoType ?? '発表';
  const controlDateTime = options?.controlDateTime ?? reportDateTime;
  const areaCode = options?.areaCode ?? '1310800';
  const areaName = options?.areaName ?? '江東区';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
  <Control>
    <Title>気象警報・注意報</Title>
    <DateTime>${controlDateTime}</DateTime>
    <Status>${controlStatus}</Status>
    <EditorialOffice>気象庁本庁</EditorialOffice>
    <PublishingOffice>気象庁</PublishingOffice>
  </Control>
  <Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
    <Title>東京都気象警報・注意報</Title>
    <ReportDateTime>${reportDateTime}</ReportDateTime>
    <TargetDateTime>${reportDateTime}</TargetDateTime>
    <EventID>EVENT1</EventID>
    <InfoType>${infoType}</InfoType>
    <Serial>1</Serial>
    <InfoKind>気象警報・注意報</InfoKind>
    <InfoKindVersion>1.0_1</InfoKindVersion>
    <Headline><Text>警報・注意報</Text></Headline>
  </Head>
  <Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/">
    <Warning type="気象警報・注意報（市町村等）">
      <Item>
        <Area>
          <Name>${areaName}</Name>
          <Code>${areaCode}</Code>
        </Area>
        ${kindsXml}
      </Item>
    </Warning>
  </Body>
</Report>`;
}

function createReception(
  connection: DatabaseConnection,
  telegramType: string,
  reportDateTime: string,
  kindsXml: string,
  options?: {
    readonly controlDateTime?: string;
    readonly controlStatus?: 'normal' | 'training' | 'test';
    readonly infoType?: string;
    readonly receivedAt?: string;
    readonly areaCode?: string;
    readonly areaName?: string;
  },
): TelegramReception {
  const controlStatus = options?.controlStatus ?? 'normal';
  const controlStatusXml =
    controlStatus === 'normal' ? '通常' : controlStatus === 'training' ? '訓練' : '試験';
  const isoReport = new Date(reportDateTime).toISOString();
  const isoControl = new Date(options?.controlDateTime ?? reportDateTime).toISOString();
  const isoReceived = new Date(options?.receivedAt ?? reportDateTime).toISOString();

  const rawXml = buildXml(telegramType, isoReport, kindsXml, {
    controlDateTime: isoControl,
    controlStatus: controlStatusXml,
    infoType: options?.infoType ?? '発表',
    areaCode: options?.areaCode,
    areaName: options?.areaName,
  });

  const contentHash = crypto.createHash('sha256').update(rawXml).digest('hex');
  const docUrl = `https://example.com/xml/${telegramType}_${isoReport.replace(/[:.-]/g, '')}_${contentHash.slice(0, 8)}.xml`;

  return recordTelegramReception(connection, {
    fetchAttemptId: null,
    feedKind: 'extra',
    feedEntryId: `entry-${contentHash.slice(0, 8)}`,
    documentUrl: docUrl,
    telegramType,
    title: '東京都気象警報・注意報',
    controlStatus,
    infoType: options?.infoType ?? '発表',
    eventId: 'EVENT1',
    serial: '1',
    controlDateTime: isoControl,
    reportDateTime: isoReport,
    targetDateTime: isoReport,
    receivedAt: isoReceived,
    adoptions: [],
    rawBody: rawXml,
    bodyBytes: Buffer.byteLength(rawXml, 'utf-8'),
    contentHash,
    areas: [
      {
        areaCode: options?.areaCode ?? '1310800',
        areaName: options?.areaName ?? '江東区',
        codeType: 'jma_municipal_warning_area',
        sequence: 1,
      },
    ],
  });
}

function createFetchSourceResult(
  sourceId: MonitoredFetchSourceId,
  status: FetchSourceHealthResult['status'],
): FetchSourceHealthResult {
  return {
    sourceId,
    status,
    reasons:
      status === 'normal' || status === 'suspended'
        ? []
        : [
            {
              kind: 'consecutive_failures',
              status,
              sourceKind: sourceId,
              text: '連続失敗',
            },
          ],
    lastAttemptAt: '2026-09-12T01:00:00.000Z' as UtcIso8601String,
    lastSuccessAt: '2026-09-12T00:59:00.000Z' as UtcIso8601String,
    maxConsecutiveFailures: status === 'abnormal' ? 5 : status === 'delayed' ? 2 : 0,
    intervalSeconds: 60,
  };
}

test('D8 横断受け入れテスト: 気象内容／装置異常の区別と検知文脈の直交性 (AC1〜AC5)', () => {
  const { connection, cleanup } = createTempDb();
  try {
    // 1. D4 気象初期復旧経路の実行 (weather + initial)
    const weatherNow: UtcIso8601String = '2026-09-12T01:00:00.000Z';
    const weatherNotificationId = 'weather-notif-001';

    createReception(
      connection,
      'VPWS50',
      '2026-09-12T00:50:00.000Z',
      '<Kind><Name>レベル３大雨警報</Name><Code>03</Code><Status>発表</Status></Kind>',
      { receivedAt: '2026-09-12T00:50:05.000Z' },
    );

    rebuildWarningCurrentFromReceptions(connection, EAST_VENUE.targetArea);

    const weatherTracker = new InitialWarningNotificationTracker();
    const weatherEmitDeps: WarningNotificationEmitDeps = {
      tracker: weatherTracker,
      now: () => weatherNow,
      notificationIdFactory: () => weatherNotificationId,
    };

    const weatherResult = emitInitialWarningNotifications(
      connection,
      EAST_VENUE.targetArea,
      weatherEmitDeps,
    );
    assert.equal(weatherResult.recordedCount, 1);

    // 2. D7 装置異常系経路の実行 (system + normal)
    const systemNow: UtcIso8601String = '2026-09-12T01:05:00.000Z';
    const systemNotificationId = 'system-notif-001';
    const stateStore = new FetchHealthStateStore();

    // 2-1: 起動直後全取得元 normal の初期評価（通知 0 件）
    const initialAggregate = aggregateFetchHealth(
      MONITORED_FETCH_SOURCES.map((def) => createFetchSourceResult(def.id, 'normal')),
      systemNow,
    );
    const initialSystemResult = emitFetchHealthNotification(
      connection,
      initialAggregate,
      stateStore,
      {
        now: () => systemNow,
        notificationIdFactory: () => 'system-notif-initial',
      },
    );
    assert.equal(initialSystemResult.recorded.length, 0);

    // 2-2: xml_regular が delayed に遷移（1 件生成）
    const delayedAggregate = aggregateFetchHealth(
      MONITORED_FETCH_SOURCES.map((def) =>
        createFetchSourceResult(def.id, def.id === 'xml_regular' ? 'delayed' : 'normal'),
      ),
      systemNow,
    );
    const delayedSystemResult = emitFetchHealthNotification(
      connection,
      delayedAggregate,
      stateStore,
      {
        now: () => systemNow,
        notificationIdFactory: () => systemNotificationId,
      },
    );
    assert.equal(delayedSystemResult.recorded.length, 1);

    // 3. AC3: 同一 DB・同一 notification_output_history に保存した無条件一覧がちょうど 2 件で完全一致
    const allHistory = listNotificationOutputHistory(connection);
    assert.equal(allHistory.length, 2);

    const weatherHistory = allHistory.find((h) => h.notificationId === weatherNotificationId);
    assert.ok(weatherHistory, '気象通知が履歴に存在すること');
    // AC1 & AC3: 気象通知の完全一致検証
    assert.equal(weatherHistory.origin, 'weather');
    assert.equal(weatherHistory.detectionContext, 'initial');
    assert.equal(weatherHistory.sourceType, 'warning_current');
    assert.equal(weatherHistory.changeType, 'new');
    assert.equal(weatherHistory.category, 'question');
    assert.equal(weatherHistory.messageDefinitionId, 'weather-warning-issued');
    assert.equal(weatherHistory.messageDefinitionVersion, '1');
    assert.equal(weatherHistory.isTraining, false);

    const systemHistory = allHistory.find((h) => h.notificationId === systemNotificationId);
    assert.ok(systemHistory, '装置異常通知が履歴に存在すること');
    // AC2 & AC3: 装置異常通知の完全一致検証
    assert.equal(systemHistory.origin, 'system');
    assert.equal(systemHistory.detectionContext, 'normal');
    assert.equal(systemHistory.sourceType, 'fetch_health');
    assert.equal(systemHistory.changeType, 'fetch_delayed');
    assert.equal(systemHistory.category, 'warning');
    assert.equal(systemHistory.messageDefinitionId, 'system-data-fetch-delayed');
    assert.equal(systemHistory.messageDefinitionVersion, '1');
    assert.equal(systemHistory.isTraining, false);

    // 4. AC4: origin: 'weather' / 'system' の一覧検索がそれぞれ該当通知のみを返し、相互混入しない
    const weatherOnly = listNotificationOutputHistory(connection, { origin: 'weather' });
    assert.equal(weatherOnly.length, 1);
    assert.equal(weatherOnly[0].notificationId, weatherNotificationId);
    assert.equal(weatherOnly[0].origin, 'weather');
    assert.equal(weatherOnly[0].detectionContext, 'initial');

    const systemOnly = listNotificationOutputHistory(connection, { origin: 'system' });
    assert.equal(systemOnly.length, 1);
    assert.equal(systemOnly[0].notificationId, systemNotificationId);
    assert.equal(systemOnly[0].origin, 'system');
    assert.equal(systemOnly[0].detectionContext, 'normal');

    // 5. AC5: detectionContext: 'initial' / 'normal' の一覧検索が独立した軸として機能する
    const initialOnly = listNotificationOutputHistory(connection, {
      detectionContext: 'initial',
    });
    assert.equal(initialOnly.length, 1);
    assert.equal(initialOnly[0].notificationId, weatherNotificationId);
    assert.equal(initialOnly[0].origin, 'weather');
    assert.equal(initialOnly[0].detectionContext, 'initial');

    const normalOnly = listNotificationOutputHistory(connection, {
      detectionContext: 'normal',
    });
    assert.equal(normalOnly.length, 1);
    assert.equal(normalOnly[0].notificationId, systemNotificationId);
    assert.equal(normalOnly[0].origin, 'system');
    assert.equal(normalOnly[0].detectionContext, 'normal');
  } finally {
    cleanup();
  }
});
