import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import { initializeDatabase } from '../src/database/index.js';
import {
  findWarningCurrentSnapshot,
  listNotificationOutputHistory,
  recordTelegramReception,
  type TelegramReception,
} from '../src/repositories/index.js';
import {
  applyWarningCurrentReception,
  rebuildWarningCurrentFromReceptions,
} from '../src/polling/jmaWarningCurrentProcessor.js';
import { parseWarningTelegram } from '../src/polling/jmaWarningTelegramParser.js';
import { processWarningTelegramReception } from '../src/polling/jmaWarningTelegramProcessor.js';
import { resolveVenueWarningContext } from '../src/venueForecastTargets.js';
import {
  InitialWarningNotificationTracker,
  emitInitialWarningNotifications,
  emitWarningNotificationsForReception,
  type WarningNotificationEmitDeps,
} from '../src/notifications/index.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');
const EAST_VENUE = resolveVenueWarningContext('east'); // 江東区: 1310800

function createTempDb(): {
  connection: ReturnType<typeof initializeDatabase>['connection'];
  cleanup: () => void;
} {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-warning-rules-test-'));
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
  connection: ReturnType<typeof initializeDatabase>['connection'],
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

test('AC1: 同一 contentHash の電文を 2 回処理しても通知は 1 回だけ生成される', () => {
  const { connection, cleanup } = createTempDb();
  try {
    const tracker = new InitialWarningNotificationTracker();
    const emitDeps: WarningNotificationEmitDeps = {
      tracker,
      now: () => '2026-09-12T00:00:01Z',
    };

    const reception = createReception(
      connection,
      'VPWS50',
      '2026-09-12T00:00:00Z',
      '<Kind><Name>レベル３大雨警報</Name><Code>03</Code><Status>発表</Status></Kind>',
      { receivedAt: '2026-09-12T00:00:01Z' },
    );

    // 1 回目実行
    const result1 = processWarningTelegramReception(
      connection,
      reception,
      '2026-09-12T00:00:01Z',
      EAST_VENUE,
      emitDeps,
    );
    assert.equal(result1.ok, true);

    const history1 = listNotificationOutputHistory(connection);
    assert.ok(history1.length >= 1, '1回目は通知が生成されていること');
    const countN = history1.length;

    // 2 回目実行（同一 reception）
    const result2 = processWarningTelegramReception(
      connection,
      reception,
      '2026-09-12T00:00:02Z',
      EAST_VENUE,
      emitDeps,
    );
    assert.equal(result2.ok, true);

    const history2 = listNotificationOutputHistory(connection);
    assert.equal(history2.length, countN, '2回目実行後も通知件数は増えないこと');
  } finally {
    cleanup();
  }
});

test('AC2: プロセス再起動を模して tracker を作り直すと、既存現況が new として再通知される', () => {
  const { connection, cleanup } = createTempDb();
  try {
    const tracker1 = new InitialWarningNotificationTracker();
    const emitDeps1: WarningNotificationEmitDeps = {
      tracker: tracker1,
      now: () => '2026-09-12T00:00:01Z',
    };

    const reception = createReception(
      connection,
      'VPWS50',
      '2026-09-12T00:00:00Z',
      '<Kind><Name>レベル３大雨警報</Name><Code>03</Code><Status>発表</Status></Kind>' +
        '<Kind><Name>雷注意報</Name><Code>14</Code><Status>発表</Status></Kind>',
      { receivedAt: '2026-09-12T00:00:01Z' },
    );

    processWarningTelegramReception(
      connection,
      reception,
      '2026-09-12T00:00:01Z',
      EAST_VENUE,
      emitDeps1,
    );

    const history1 = listNotificationOutputHistory(connection);
    const initialCount = history1.length;
    assert.equal(initialCount, 2);

    // プロセス再起動の等価物: 新しい tracker を生成
    const tracker2 = new InitialWarningNotificationTracker();
    const emitDeps2: WarningNotificationEmitDeps = {
      tracker: tracker2,
      now: () => '2026-09-12T01:00:00Z',
    };

    rebuildWarningCurrentFromReceptions(connection, EAST_VENUE.targetArea);
    const emitResult = emitInitialWarningNotifications(
      connection,
      EAST_VENUE.targetArea,
      emitDeps2,
    );

    assert.equal(emitResult.recordedCount, 2, '現況アイテム件数 (2件) と同じだけ生成される');

    const history2 = listNotificationOutputHistory(connection);
    assert.equal(history2.length, initialCount + 2);

    // 追加分の検証（降順のため先頭の2件が新しく追加された初期復旧通知）
    const addedNotifications = history2.slice(0, 2);
    for (const notif of addedNotifications) {
      assert.equal(notif.changeType, 'new');
      assert.equal(notif.detectionContext, 'initial');
    }

    const rainNotif = addedNotifications.find((n) => n.summary.includes('大雨警報'));
    assert.ok(rainNotif);
    assert.equal(rainNotif.category, 'question'); // 03 は question

    const thunderNotif = addedNotifications.find((n) => n.summary.includes('雷注意報'));
    assert.ok(thunderNotif);
    assert.equal(thunderNotif.category, 'warning'); // 14 は warning

    // もう一度 emitInitialWarningNotifications を同じ tracker で呼んでも増えない
    const emitResult2 = emitInitialWarningNotifications(
      connection,
      EAST_VENUE.targetArea,
      emitDeps2,
    );
    assert.equal(emitResult2.recordedCount, 0);
    const history3 = listNotificationOutputHistory(connection);
    assert.equal(history3.length, history2.length);
  } finally {
    cleanup();
  }
});

test('AC3: 継続では通知が生成されない', () => {
  const { connection, cleanup } = createTempDb();
  try {
    const tracker = new InitialWarningNotificationTracker();
    const emitDeps: WarningNotificationEmitDeps = {
      tracker,
      now: () => '2026-09-12T00:00:01Z',
    };

    const rec1 = createReception(
      connection,
      'VPWS50',
      '2026-09-12T00:00:00Z',
      '<Kind><Name>レベル３大雨警報</Name><Code>03</Code><Status>発表</Status></Kind>',
      { receivedAt: '2026-09-12T00:00:01Z' },
    );
    processWarningTelegramReception(connection, rec1, '2026-09-12T00:00:01Z', EAST_VENUE, emitDeps);

    const history1 = listNotificationOutputHistory(connection);
    assert.equal(history1.length, 1);

    // reportDateTime だけ進んだ同一内容の電文（継続）
    const rec2 = createReception(
      connection,
      'VPWS50',
      '2026-09-12T01:00:00Z',
      '<Kind><Name>レベル３大雨警報</Name><Code>03</Code><Status>継続</Status></Kind>',
      { receivedAt: '2026-09-12T01:00:01Z' },
    );
    processWarningTelegramReception(connection, rec2, '2026-09-12T01:00:01Z', EAST_VENUE, emitDeps);

    const history2 = listNotificationOutputHistory(connection);
    assert.equal(history2.length, 1, '継続では通知が追加されない');
  } finally {
    cleanup();
  }
});

test('AC4: 新規発表の区分と定義 ID (03, 33, 10, 14)', () => {
  const { connection, cleanup } = createTempDb();
  try {
    const tracker = new InitialWarningNotificationTracker();
    const emitDeps: WarningNotificationEmitDeps = {
      tracker,
      now: () => '2026-09-12T00:00:01Z',
    };

    // 03 (大雨警報), 14 (雷注意報)
    const rec1 = createReception(
      connection,
      'VPWS50',
      '2026-09-12T00:00:00Z',
      '<Kind><Name>レベル３大雨警報</Name><Code>03</Code><Status>発表</Status></Kind>' +
        '<Kind><Name>雷注意報</Name><Code>14</Code><Status>発表</Status></Kind>',
    );
    processWarningTelegramReception(connection, rec1, '2026-09-12T00:00:01Z', EAST_VENUE, emitDeps);

    const history = listNotificationOutputHistory(connection);
    assert.equal(history.length, 2);

    const rain03 = history.find((n) => n.summary.includes('レベル３大雨警報'))!;
    assert.ok(rain03);
    assert.equal(rain03.changeType, 'new');
    assert.equal(rain03.category, 'question');
    assert.equal(rain03.ackRequired, true);
    assert.equal(rain03.messageDefinitionId, 'weather-warning-issued');
    assert.equal(rain03.messageDefinitionVersion, '1');
    assert.equal(rain03.summary, '気象警報発表\n江東区\nレベル３大雨警報');

    const thunder14 = history.find((n) => n.summary.includes('雷注意報'))!;
    assert.ok(thunder14);
    assert.equal(thunder14.changeType, 'new');
    assert.equal(thunder14.category, 'warning');
    assert.equal(thunder14.ackRequired, false);
    assert.equal(thunder14.messageDefinitionId, 'weather-advisory-issued');
  } finally {
    cleanup();
  }
});

test('AC4 (追補): 33 (特別警報) と 14 (注意報) の区分と定義 ID', () => {
  const { connection, cleanup } = createTempDb();
  try {
    const tracker = new InitialWarningNotificationTracker();
    const emitDeps: WarningNotificationEmitDeps = {
      tracker,
      now: () => '2026-09-12T00:00:01Z',
    };

    const rec = createReception(
      connection,
      'VPWS50',
      '2026-09-12T00:00:00Z',
      '<Kind><Name>大雨特別警報</Name><Code>33</Code><Status>発表</Status></Kind>' +
        '<Kind><Name>雷注意報</Name><Code>14</Code><Status>発表</Status></Kind>',
    );
    processWarningTelegramReception(connection, rec, '2026-09-12T00:00:01Z', EAST_VENUE, emitDeps);

    const history = listNotificationOutputHistory(connection);
    const special33 = history.find((n) => n.summary.includes('大雨特別警報'))!;
    assert.ok(special33);
    assert.equal(special33.category, 'emergency');
    assert.equal(special33.messageDefinitionId, 'weather-special-warning-issued');

    const adv14 = history.find((n) => n.summary.includes('雷注意報'))!;
    assert.ok(adv14);
    assert.equal(adv14.category, 'warning');
    assert.equal(adv14.messageDefinitionId, 'weather-advisory-issued');
  } finally {
    cleanup();
  }
});

test('AC5: 訂正は常に通知される', () => {
  const { connection, cleanup } = createTempDb();
  try {
    const tracker = new InitialWarningNotificationTracker();
    const emitDeps: WarningNotificationEmitDeps = {
      tracker,
      now: () => '2026-09-12T00:00:01Z',
    };

    // 初回発表
    const rec1 = createReception(
      connection,
      'VPWS50',
      '2026-09-12T00:00:00Z',
      '<Kind><Name>レベル３大雨警報</Name><Code>03</Code><Status>発表</Status></Kind>',
      { receivedAt: '2026-09-12T00:00:01Z' },
    );
    processWarningTelegramReception(connection, rec1, '2026-09-12T00:00:01Z', EAST_VENUE, emitDeps);

    const history1 = listNotificationOutputHistory(connection);
    assert.equal(history1.length, 1);

    // InfoType=訂正 で警報コードが変わらない電文
    const rec2 = createReception(
      connection,
      'VPWS50',
      '2026-09-12T01:00:00Z',
      '<Kind><Name>レベル３大雨警報</Name><Code>03</Code><Status>継続</Status></Kind>',
      { infoType: '訂正', receivedAt: '2026-09-12T01:00:01Z' },
    );
    processWarningTelegramReception(connection, rec2, '2026-09-12T01:00:01Z', EAST_VENUE, emitDeps);

    const history2 = listNotificationOutputHistory(connection);
    assert.equal(history2.length, 2, '訂正電文により通知が1件追加される');

    const correctedNotif = history2.find((n) => n.changeType === 'corrected');
    assert.ok(correctedNotif, 'changeType: corrected の通知が存在すること');
    assert.equal(correctedNotif.category, 'question'); // 03 は question
    assert.equal(correctedNotif.messageDefinitionId, 'weather-warning-corrected');

    // 同じ版（同一 contentHash）の訂正電文を再投入すると通知が増えない
    processWarningTelegramReception(connection, rec2, '2026-09-12T01:00:02Z', EAST_VENUE, emitDeps);
    const history3 = listNotificationOutputHistory(connection);
    assert.equal(history3.length, 2);
  } finally {
    cleanup();
  }
});

test('AC6-1: 取消は解除相当として通知される（基本ケース）', () => {
  const { connection, cleanup } = createTempDb();
  try {
    const tracker = new InitialWarningNotificationTracker();
    const emitDeps: WarningNotificationEmitDeps = {
      tracker,
      now: () => '2026-09-12T00:00:01Z',
    };

    // 1. VPWS50 で初期化（雷注意報 14 のみ、大雨はなし）
    const recVpws = createReception(
      connection,
      'VPWS50',
      '2026-09-12T00:00:00Z',
      '<Kind><Name>雷注意報</Name><Code>14</Code><Status>発表</Status></Kind>',
      { receivedAt: '2026-09-12T00:00:01Z' },
    );
    processWarningTelegramReception(
      connection,
      recVpws,
      '2026-09-12T00:00:01Z',
      EAST_VENUE,
      emitDeps,
    );

    // 2. VPWW55 で大雨警報を発表
    const recVpww = createReception(
      connection,
      'VPWW55',
      '2026-09-12T00:10:00Z',
      '<Kind><Name>レベル３大雨警報</Name><Code>03</Code><Status>発表</Status></Kind>',
      { receivedAt: '2026-09-12T00:10:01Z' },
    );
    processWarningTelegramReception(
      connection,
      recVpww,
      '2026-09-12T00:10:01Z',
      EAST_VENUE,
      emitDeps,
    );

    const historyBeforeCancel = listNotificationOutputHistory(connection);

    // 3. VPWW55 の InfoType=取消 電文（ダミー Kind を含める）
    const recCancel = createReception(
      connection,
      'VPWW55',
      '2026-09-12T01:00:00Z',
      '<Kind><Name>ダミー大雨警報</Name><Code>03</Code><Status>発表</Status></Kind>',
      { infoType: '取消', receivedAt: '2026-09-12T01:00:01Z' },
    );
    const resultCancel = processWarningTelegramReception(
      connection,
      recCancel,
      '2026-09-12T01:00:01Z',
      EAST_VENUE,
      emitDeps,
    );

    assert.equal(resultCancel.ok, true);

    // 現況スナップショットから heavy_rain が消えていること
    const snapshot = findWarningCurrentSnapshot(
      connection,
      EAST_VENUE.targetArea.municipalCode,
      'normal',
    );
    assert.ok(snapshot);
    const heavyRainItem = snapshot.items.find((i) => i.kindCode === '03');
    assert.equal(heavyRainItem, undefined, 'heavy_rain が現況から消えている');
    // ダミー Kind が取り込まれていないこと
    const dummyItem = snapshot.items.find((i) => i.kindName === 'ダミー大雨警報');
    assert.equal(dummyItem, undefined, '取消電文の本文 Kind は取り込まれない');

    // 通知の検証
    const historyAfterCancel = listNotificationOutputHistory(connection);
    assert.equal(historyAfterCancel.length, historyBeforeCancel.length + 1);

    const cancelNotif = historyAfterCancel[0]!; // 最新
    assert.equal(cancelNotif.changeType, 'cancelled');
    assert.equal(cancelNotif.category, 'warning', '取消通知の category は warning 固定');
    assert.equal(cancelNotif.ackRequired, false);
    assert.equal(cancelNotif.messageDefinitionId, 'weather-warning-cancelled');
    assert.equal(cancelNotif.summary, '気象警報等取消\n江東区\nレベル３大雨警報');

    // 同一番の再投入で duplicate
    processWarningTelegramReception(
      connection,
      recCancel,
      '2026-09-12T01:00:02Z',
      EAST_VENUE,
      emitDeps,
    );
    const historyAfterDuplicate = listNotificationOutputHistory(connection);
    assert.equal(historyAfterDuplicate.length, historyAfterCancel.length);

    // 取消後にプロセス再起動相当を行っても、取消前の内容が現況に復活しない
    const trackerNew = new InitialWarningNotificationTracker();
    const emitDepsNew: WarningNotificationEmitDeps = {
      tracker: trackerNew,
      now: () => '2026-09-12T02:00:00Z',
    };
    rebuildWarningCurrentFromReceptions(connection, EAST_VENUE.targetArea);
    emitInitialWarningNotifications(connection, EAST_VENUE.targetArea, emitDepsNew);

    const snapshotAfterRebuild = findWarningCurrentSnapshot(
      connection,
      EAST_VENUE.targetArea.municipalCode,
      'normal',
    );
    assert.ok(snapshotAfterRebuild);
    assert.equal(
      snapshotAfterRebuild.items.find((i) => i.kindCode === '03'),
      undefined,
      '復旧後も取消前の内容は復活しない',
    );
  } finally {
    cleanup();
  }
});

test('AC6-2: 集約側フォールバック経路（今回の欠陥の回帰テスト）', () => {
  const { connection, cleanup } = createTempDb();
  try {
    const tracker = new InitialWarningNotificationTracker();
    const emitDeps: WarningNotificationEmitDeps = {
      tracker,
      now: () => '2026-09-12T00:00:01Z',
    };

    // 1. VPWS50 で 03 (大雨警報) と 14 (雷注意報) を発表
    const recVpws = createReception(
      connection,
      'VPWS50',
      '2026-09-12T00:00:00Z',
      '<Kind><Name>レベル３大雨警報</Name><Code>03</Code><Status>発表</Status></Kind>' +
        '<Kind><Name>雷注意報</Name><Code>14</Code><Status>発表</Status></Kind>',
      { receivedAt: '2026-09-12T00:00:01Z' },
    );
    processWarningTelegramReception(
      connection,
      recVpws,
      '2026-09-12T00:00:01Z',
      EAST_VENUE,
      emitDeps,
    );

    // 2. 個別 VPWW55 で同じ 03 を継続発表 (reportDateTime 前進)
    const recVpww = createReception(
      connection,
      'VPWW55',
      '2026-09-12T00:10:00Z',
      '<Kind><Name>レベル３大雨警報</Name><Code>03</Code><Status>継続</Status></Kind>',
      { receivedAt: '2026-09-12T00:10:01Z' },
    );
    processWarningTelegramReception(
      connection,
      recVpww,
      '2026-09-12T00:10:01Z',
      EAST_VENUE,
      emitDeps,
    );

    const snapshotBeforeCancel = findWarningCurrentSnapshot(
      connection,
      EAST_VENUE.targetArea.municipalCode,
      'normal',
    )!;
    const historyBeforeCancel = listNotificationOutputHistory(connection);

    // 3. 同 VPWW55 の InfoType=取消 電文 (reportDateTime さらに前進)
    const recCancel = createReception(
      connection,
      'VPWW55',
      '2026-09-12T00:20:00Z',
      '<Kind><Name>ダミー大雨警報</Name><Code>03</Code><Status>発表</Status></Kind>',
      { infoType: '取消', receivedAt: '2026-09-12T00:20:01Z' },
    );
    const resultCancel = processWarningTelegramReception(
      connection,
      recCancel,
      '2026-09-12T00:20:01Z',
      EAST_VENUE,
      emitDeps,
    );

    assert.equal(resultCancel.ok, true);

    // 取消後の現況スナップショットに heavy_rain (03) が含まれない（VPWS50 が 03 を保持していても復活しない）
    const snapshotAfterCancel = findWarningCurrentSnapshot(
      connection,
      EAST_VENUE.targetArea.municipalCode,
      'normal',
    );
    assert.ok(snapshotAfterCancel);
    assert.equal(
      snapshotAfterCancel.items.find((i) => i.kindCode === '03'),
      undefined,
      'VPWS50 が保持していても取消により 03 は消える',
    );

    // 取消後の現況に 14 (thunder) は残っている
    assert.equal(snapshotAfterCancel.items.length, 1);
    assert.equal(snapshotAfterCancel.items[0]!.kindCode, '14');

    // changeType='cancelled' の通知が 1 件生成
    const historyAfterCancel = listNotificationOutputHistory(connection);
    assert.equal(historyAfterCancel.length, historyBeforeCancel.length + 1);

    const cancelNotif = historyAfterCancel[0]!;
    assert.equal(cancelNotif.changeType, 'cancelled');
    assert.equal(cancelNotif.category, 'warning');
    assert.equal(cancelNotif.ackRequired, false);
    assert.equal(cancelNotif.messageDefinitionId, 'weather-warning-cancelled');
    assert.ok(cancelNotif.summary.includes('レベル３大雨警報'));

    // sourceVersion が取消前後で変化している
    assert.notEqual(
      snapshotAfterCancel.metadata.sourceVersion,
      snapshotBeforeCancel.metadata.sourceVersion,
      'sourceVersion が変化していること',
    );

    // 続けて rebuildWarningCurrentFromReceptions を実行しても heavy_rain が復活せず thunder は残る
    rebuildWarningCurrentFromReceptions(connection, EAST_VENUE.targetArea);
    const snapshotAfterRebuild = findWarningCurrentSnapshot(
      connection,
      EAST_VENUE.targetArea.municipalCode,
      'normal',
    );
    assert.ok(snapshotAfterRebuild);
    assert.equal(
      snapshotAfterRebuild.items.find((i) => i.kindCode === '03'),
      undefined,
      'rebuild 後も heavy_rain は復活しない',
    );
    assert.equal(
      snapshotAfterRebuild.items.find((i) => i.kindCode === '14')?.kindCode,
      '14',
      'rebuild 後も thunder は残る',
    );
  } finally {
    cleanup();
  }
});

test('AC6-3: 取消が現況を変化させない場合 (no-op) は cancel_without_effect が記録される', () => {
  const { connection, cleanup } = createTempDb();
  try {
    const tracker = new InitialWarningNotificationTracker();
    const emitDeps: WarningNotificationEmitDeps = {
      tracker,
      now: () => '2026-09-12T00:00:01Z',
    };

    // 1. VPWS50 で 14 (雷注意報) のみを発表
    const recVpws = createReception(
      connection,
      'VPWS50',
      '2026-09-12T00:00:00Z',
      '<Kind><Name>雷注意報</Name><Code>14</Code><Status>発表</Status></Kind>',
      { receivedAt: '2026-09-12T00:00:01Z' },
    );
    processWarningTelegramReception(
      connection,
      recVpws,
      '2026-09-12T00:00:01Z',
      EAST_VENUE,
      emitDeps,
    );

    const historyBeforeCancel = listNotificationOutputHistory(connection);

    // 2. VPWW55 の現象が現況にない状態から、VPWW55 の InfoType=取消 を投入
    const recCancel = createReception(
      connection,
      'VPWW55',
      '2026-09-12T00:10:00Z',
      '<Kind><Name>ダミー大雨警報</Name><Code>03</Code><Status>発表</Status></Kind>',
      { infoType: '取消', receivedAt: '2026-09-12T00:10:01Z' },
    );

    const parseResult = parseWarningTelegram(recCancel.rawBody!, recCancel, EAST_VENUE.targetArea);
    assert.equal(parseResult.ok, true);
    if (!parseResult.ok) return;

    const applyResult = applyWarningCurrentReception(
      connection,
      recCancel,
      parseResult.value,
      EAST_VENUE.targetArea,
    );
    assert.equal(applyResult.applied, true);
    if (!applyResult.applied) return;

    const emitResult = emitWarningNotificationsForReception(
      connection,
      recCancel,
      applyResult,
      parseResult.value,
      emitDeps,
    );

    assert.equal(emitResult.recordedCount, 0);
    const cancelSkip = emitResult.skipped.find((s) => s.reason === 'cancel_without_effect');
    assert.ok(cancelSkip, 'cancel_without_effect の skipped 記録が含まれること');
    assert.equal(cancelSkip.phenomenonKey, null);
    assert.equal(cancelSkip.changeType, 'cancelled');

    // 通知件数が増えていないこと
    const historyAfterCancel = listNotificationOutputHistory(connection);
    assert.equal(historyAfterCancel.length, historyBeforeCancel.length);
  } finally {
    cleanup();
  }
});

test('AC8: 訓練データが本番と混同されない', () => {
  const { connection, cleanup } = createTempDb();
  try {
    const tracker = new InitialWarningNotificationTracker();
    const emitDeps: WarningNotificationEmitDeps = {
      tracker,
      now: () => '2026-09-12T00:00:01Z',
    };

    // 1. 訓練電文
    const recTraining = createReception(
      connection,
      'VPWS50',
      '2026-09-12T00:00:00Z',
      '<Kind><Name>レベル３大雨警報</Name><Code>03</Code><Status>発表</Status></Kind>',
      { controlStatus: 'training', receivedAt: '2026-09-12T00:00:01Z' },
    );
    processWarningTelegramReception(
      connection,
      recTraining,
      '2026-09-12T00:00:01Z',
      EAST_VENUE,
      emitDeps,
    );

    // 2. 本番電文
    const recNormal = createReception(
      connection,
      'VPWS50',
      '2026-09-12T00:00:00Z',
      '<Kind><Name>レベル３大雨警報</Name><Code>03</Code><Status>発表</Status></Kind>',
      { controlStatus: 'normal', receivedAt: '2026-09-12T00:00:01Z' },
    );
    processWarningTelegramReception(
      connection,
      recNormal,
      '2026-09-12T00:00:01Z',
      EAST_VENUE,
      emitDeps,
    );

    const allHistory = listNotificationOutputHistory(connection);
    assert.equal(allHistory.length, 2);

    const trainingNotif = allHistory.find((n) => n.isTraining === true);
    assert.ok(trainingNotif);
    assert.equal(trainingNotif.category, 'question', '訓練だからといって区分が下がらない');

    const normalNotif = allHistory.find((n) => n.isTraining === false);
    assert.ok(normalNotif);
    assert.equal(normalNotif.category, 'question');

    // isTraining: false で絞り込み
    const normalOnly = listNotificationOutputHistory(connection, { isTraining: false });
    assert.equal(normalOnly.length, 1);
    assert.equal(normalOnly[0]!.notificationId, normalNotif.notificationId);
  } finally {
    cleanup();
  }
});
