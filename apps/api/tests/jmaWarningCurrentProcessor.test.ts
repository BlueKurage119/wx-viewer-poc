import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import { VENUE_IDS, type ControlStatus, type UtcIso8601String } from '@wx-viewer-poc/shared';
import { initializeDatabase } from '../src/database/index.js';
import {
  findWarningCurrentSnapshot,
  listWarningCurrentStreams,
  recordTelegramReception,
  type TelegramReception,
} from '../src/repositories/index.js';
import {
  applyWarningCurrentReception,
  rebuildWarningCurrentFromReceptions,
} from '../src/polling/jmaWarningCurrentProcessor.js';
import {
  processWarningTelegramReceptionForAllVenues,
  reprocessPendingWarningTelegramReceptions,
} from '../src/polling/jmaWarningTelegramProcessor.js';
import { parseWarningTelegram } from '../src/polling/jmaWarningTelegramParser.js';
import {
  resolveVenueWarningContext,
  resolveWarningCurrentTargetArea,
} from '../src/venueForecastTargets.js';
import { getVenueWarningCurrent } from '../src/services/venueWeatherService.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');
const DEFAULT_WARNING_CURRENT_TARGET_AREA = resolveWarningCurrentTargetArea('east');

function createTempDb(): {
  connection: ReturnType<typeof initializeDatabase>['connection'];
  cleanup: () => void;
} {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-warning-processor-'));
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

function saveAndProcessReception(
  connection: ReturnType<typeof initializeDatabase>['connection'],
  telegramType: string,
  reportDateTime: string,
  kindsXml: string,
  options?: {
    readonly controlDateTime?: string;
    readonly controlStatus?: 'normal' | 'training' | 'test';
    readonly infoType?: string;
    readonly areaCode?: string;
    readonly areaName?: string;
    readonly receivedAt?: string;
    readonly url?: string;
    readonly targetArea?: typeof DEFAULT_WARNING_CURRENT_TARGET_AREA;
  },
): { reception: TelegramReception; parseResult: ReturnType<typeof parseWarningTelegram> } {
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
  const docUrl =
    options?.url ??
    `https://example.com/xml/${telegramType}_${isoReport.replace(/[:.-]/g, '')}_${contentHash.slice(0, 8)}.xml`;

  const reception = recordTelegramReception(connection, {
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
        codeType: '気象警報・注意報（市町村等）',
        sequence: 1,
      },
    ],
  });

  const targetArea = options?.targetArea ?? DEFAULT_WARNING_CURRENT_TARGET_AREA;
  const parseResult = parseWarningTelegram(rawXml, reception, targetArea);

  let applyResult: WarningCurrentApplyResult | undefined;
  if (parseResult.ok) {
    applyResult = applyWarningCurrentReception(
      connection,
      reception,
      parseResult.value,
      targetArea,
    );
  }

  return { reception, parseResult, applyResult };
}

test('1. 初期 DB で個別 VPWW55 だけを処理しても snapshot は 0 件で、ポインターは 1 件 (uninitialized)', () => {
  const { connection, cleanup } = createTempDb();
  try {
    const kindsXml = `<Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>`;
    saveAndProcessReception(connection, 'VPWW55', '2026-09-09T01:00:00Z', kindsXml);

    // snapshot は作成されない（未初期化）
    const snapshot = findWarningCurrentSnapshot(connection, '1310800', 'normal');
    assert.equal(snapshot, null);

    // ストリームポインターは 1 件保存されている
    const streams = listWarningCurrentStreams(connection, '130000', '1310800', 'normal');
    assert.equal(streams.length, 1);
    assert.equal(streams[0]!.telegramType, 'VPWW55');
  } finally {
    cleanup();
  }
});

test('TRC adapter は大田区・東京都のストリームキーで現況を構成する', () => {
  const { connection, cleanup } = createTempDb();
  try {
    const targetArea = resolveWarningCurrentTargetArea('trc');
    const { parseResult } = saveAndProcessReception(
      connection,
      'VPWS50',
      '2026-09-09T01:00:00Z',
      '<Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status></Kind>',
      { areaCode: '1311100', areaName: '大田区', targetArea },
    );
    assert.equal(parseResult.ok, true);
    assert.ok(findWarningCurrentSnapshot(connection, '1311100', 'normal'));
    assert.equal(findWarningCurrentSnapshot(connection, '1310800', 'normal'), null);
    const streams = listWarningCurrentStreams(connection, '130000', '1311100', 'normal');
    assert.equal(streams.length, 1);
    assert.deepEqual(
      {
        prefectureCode: streams[0]!.prefectureCode,
        areaCode: streams[0]!.areaCode,
        controlStatus: streams[0]!.controlStatus,
        telegramType: streams[0]!.telegramType,
        reportDateTime: streams[0]!.reportDateTime,
        controlDateTime: streams[0]!.controlDateTime,
      },
      {
        prefectureCode: '130000',
        areaCode: '1311100',
        controlStatus: 'normal',
        telegramType: 'VPWS50',
        reportDateTime: '2026-09-09T01:00:00.000Z',
        controlDateTime: '2026-09-09T01:00:00.000Z',
      },
    );
  } finally {
    cleanup();
  }
});

test('2. 個別受信後に古い要素時刻の VPWS50 が届いても、個別の新しい大雨を保持して初期化される', () => {
  const { connection, cleanup } = createTempDb();
  try {
    // 先に VPWW55 (大雨警報 03, report 02:00) を受信
    const vpww55Xml = `<Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status><DateTime>2026-09-09T02:00:00Z</DateTime></Kind>`;
    saveAndProcessReception(connection, 'VPWW55', '2026-09-09T02:00:00Z', vpww55Xml);

    // 後から届いた VPWS50 (大雨注意報 10, 要素時刻 01:00, レポート時刻 02:00)
    const vpws50Xml = `
      <Kind><Name>大雨注意報</Name><Code>10</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
      <Kind><Name>高潮注意報</Name><Code>19</Code><Status>発表</Status><DateTime>2026-09-09T01:30:00Z</DateTime></Kind>
    `;
    saveAndProcessReception(connection, 'VPWS50', '2026-09-09T02:00:00Z', vpws50Xml);

    const snapshot = findWarningCurrentSnapshot(connection, '1310800', 'normal');
    assert.ok(snapshot);
    assert.equal(snapshot.metadata.availability, 'available');
    assert.equal(snapshot.items.length, 2);

    // 個別の 03 (大雨警報) が保持され、集約の 19 (高潮注意報) が合成されている
    assert.equal(snapshot.items[0]!.kindCode, '03');
    assert.equal(snapshot.items[0]!.sourceTelegram, 'VPWW55');
    assert.equal(snapshot.items[1]!.kindCode, '19');
    assert.equal(snapshot.items[1]!.sourceTelegram, 'VPWS50');
  } finally {
    cleanup();
  }
});

test('3. VPWS50 初期化後、VPWW55 の Code=00 解除で大雨だけが消え、高潮・雷は残る', () => {
  const { connection, cleanup } = createTempDb();
  try {
    // VPWS50: 大雨警報(03), 高潮注意報(19), 雷注意報(14)
    const baseXml = `
      <Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
      <Kind><Name>高潮注意報</Name><Code>19</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
      <Kind><Name>雷注意報</Name><Code>14</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
    `;
    saveAndProcessReception(connection, 'VPWS50', '2026-09-09T01:00:00Z', baseXml);

    // VPWW55: Code=00 全解除 (02:00)
    const releaseXml = `<Kind><Name>解除</Name><Code>00</Code><Status>解除</Status><DateTime>2026-09-09T02:00:00Z</DateTime></Kind>`;
    saveAndProcessReception(connection, 'VPWW55', '2026-09-09T02:00:00Z', releaseXml);

    const snapshot = findWarningCurrentSnapshot(connection, '1310800', 'normal');
    assert.ok(snapshot);
    assert.equal(snapshot.items.length, 2);
    assert.equal(snapshot.items[0]!.kindCode, '19');
    assert.equal(snapshot.items[1]!.kindCode, '14');
  } finally {
    cleanup();
  }
});

test('4. 高潮実電文構造: VPWW57 で 48 へ強化され、VPWS50 (Code=48 解除) で高潮だけが解除される', () => {
  const { connection, cleanup } = createTempDb();
  try {
    // 1. 初期 VPWS50: 高潮警報(08), 大雨注意報(10) (01:00)
    const initXml = `
      <Kind><Name>大雨注意報</Name><Code>10</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
      <Kind><Name>高潮警報</Name><Code>08</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
    `;
    saveAndProcessReception(connection, 'VPWS50', '2026-09-09T01:00:00Z', initXml);

    // 2. VPWW57: 高潮危険警報(48), LastKind=08 へ強化 (02:00)
    const vpww57Xml = `
      <Kind><Name>高潮危険警報</Name><Code>48</Code><Status>発表</Status><DateTime>2026-09-09T02:00:00Z</DateTime><LastKind><Name>高潮警報</Name><Code>08</Code></LastKind></Kind>
    `;
    saveAndProcessReception(connection, 'VPWW57', '2026-09-09T02:00:00Z', vpww57Xml);

    const snap2 = findWarningCurrentSnapshot(connection, '1310800', 'normal');
    assert.ok(snap2);
    assert.equal(snap2.items.length, 2);
    assert.equal(snap2.items.find((i) => i.kindCode === '48')?.sourceTelegram, 'VPWW57');

    // 3. VPWS50: 高潮危険警報(48) Status=解除, LastKind=48, 要素時刻 03:00 (大雨注意報は継続)
    const vpws50Release = `
      <Kind><Name>大雨注意報</Name><Code>10</Code><Status>継続</Status><DateTime>2026-09-09T03:00:00Z</DateTime></Kind>
      <Kind><Name>高潮危険警報</Name><Code>48</Code><Status>解除</Status><DateTime>2026-09-09T03:00:00Z</DateTime><LastKind><Name>高潮危険警報</Name><Code>48</Code></LastKind></Kind>
    `;
    saveAndProcessReception(connection, 'VPWS50', '2026-09-09T03:00:00Z', vpws50Release);

    const snap3 = findWarningCurrentSnapshot(connection, '1310800', 'normal');
    assert.ok(snap3);
    assert.equal(snap3.items.length, 1);
    assert.equal(snap3.items[0]!.kindCode, '10'); // 大雨注意報だけが残る
  } finally {
    cleanup();
  }
});

test('5. 新しい個別高潮更新の後に古い要素時刻の VPWS50 を受けても巻き戻らない', () => {
  const { connection, cleanup } = createTempDb();
  try {
    // 1. 初期 VPWS50 (01:00)
    saveAndProcessReception(
      connection,
      'VPWS50',
      '2026-09-09T01:00:00Z',
      `<Kind><Name>高潮警報</Name><Code>08</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>`,
    );

    // 2. VPWW57 で 48 へ更新 (03:00)
    saveAndProcessReception(
      connection,
      'VPWW57',
      '2026-09-09T03:00:00Z',
      `<Kind><Name>高潮危険警報</Name><Code>48</Code><Status>発表</Status><DateTime>2026-09-09T03:00:00Z</DateTime></Kind>`,
    );

    const snapBefore = findWarningCurrentSnapshot(connection, '1310800', 'normal')!;
    assert.equal(snapBefore.items[0]!.kindCode, '48');

    // 3. 遅れて届いた VPWS50 (reportDateTime 03:30 だが高潮要素時刻 02:00 で Code=08)
    // 個別の 03:00 より要素時刻が古いため個別が巻き戻らない
    saveAndProcessReception(
      connection,
      'VPWS50',
      '2026-09-09T03:30:00Z',
      `<Kind><Name>高潮警報</Name><Code>08</Code><Status>発表</Status><DateTime>2026-09-09T02:00:00Z</DateTime></Kind>`,
    );

    const snapAfter = findWarningCurrentSnapshot(connection, '1310800', 'normal')!;
    assert.equal(snapAfter.items[0]!.kindCode, '48');
    assert.equal(snapAfter.items[0]!.sourceTelegram, 'VPWW57');
    // 指摘 1: 個別 VPWW57 の新しい状態を保持する場合、遅着 VPWS50 は sourceVersion・メタ情報も変更してはならない
    assert.equal(snapAfter.sourceVersion, snapBefore.sourceVersion);
    assert.deepEqual(snapAfter.metadata, snapBefore.metadata);
    assert.deepEqual(snapAfter.telegram, snapBefore.telegram);
    assert.deepEqual(snapAfter.items, snapBefore.items);
    assert.deepEqual(snapAfter, snapBefore);
  } finally {
    cleanup();
  }
});

test('5-2. 同版競合（same_version_conflict）および差分競合ではストリームとスナップショットの双方を一切更新しない', () => {
  const { connection, cleanup } = createTempDb();
  try {
    // 1. 初期 VPWS50 (01:00) で大雨警報
    saveAndProcessReception(
      connection,
      'VPWS50',
      '2026-09-09T01:00:00Z',
      `<Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>`,
    );

    const snapBefore = findWarningCurrentSnapshot(connection, '1310800', 'normal')!;
    const streamsBefore = listWarningCurrentStreams(connection, '130000', '1310800', 'normal');
    assert.equal(streamsBefore.length, 1);

    // 2. 同時刻 (01:00) で内容が異なる VPWW55（大雨注意報 10）を受信 -> reduceWarningCurrent で same_version_conflict
    const { applyResult: conflictResult1 } = saveAndProcessReception(
      connection,
      'VPWW55',
      '2026-09-09T01:00:00Z',
      `<Kind><Name>大雨注意報</Name><Code>10</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>`,
    );
    assert.equal(conflictResult1.applied, false);
    assert.equal(conflictResult1.reason, 'same_version_conflict');

    // 競合前後でポインター・スナップショットとも完全一致で不変（更新されない）こと
    const streamsAfter1 = listWarningCurrentStreams(connection, '130000', '1310800', 'normal');
    const snapAfter1 = findWarningCurrentSnapshot(connection, '1310800', 'normal')!;
    assert.deepEqual(streamsAfter1, streamsBefore);
    assert.deepEqual(snapAfter1, snapBefore);

    // 3. 差分競合: 新しい時刻だが、Status が「特別警報から警報」なのに前状態（警報03）と矛盾する電文
    // extractActiveKindsByPhenomenon の段階比較や LastKind 整合で conflict
    const { applyResult: conflictResult2 } = saveAndProcessReception(
      connection,
      'VPWW55',
      '2026-09-09T02:00:00Z',
      `<Kind><Name>大雨注意報</Name><Code>10</Code><Status>解除</Status><LastKind><Name>暴風警報</Name><Code>05</Code></LastKind></Kind>`,
    );
    assert.equal(conflictResult2.applied, false);
    assert.equal(conflictResult2.reason, 'same_version_conflict');

    const streamsAfter2 = listWarningCurrentStreams(connection, '130000', '1310800', 'normal');
    const snapAfter2 = findWarningCurrentSnapshot(connection, '1310800', 'normal')!;
    assert.deepEqual(streamsAfter2, streamsBefore);
    assert.deepEqual(snapAfter2, snapBefore);
  } finally {
    cleanup();
  }
});

test('6. 重複は duplicate で DB 無変更、同時刻別 hash は same_version_conflict で既存保持', () => {
  const { connection, cleanup } = createTempDb();
  try {
    // 初期 VPWS50
    const xml = `<Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>`;
    const { reception: rec1 } = saveAndProcessReception(
      connection,
      'VPWS50',
      '2026-09-09T01:00:00Z',
      xml,
    );

    const snap1 = findWarningCurrentSnapshot(connection, '1310800', 'normal')!;

    // 1. 同一電文の再適用 (duplicate)
    const parseResult1 = parseWarningTelegram(
      rec1.rawBody!,
      rec1,
      DEFAULT_WARNING_CURRENT_TARGET_AREA,
    );
    assert.ok(parseResult1.ok);
    const resultDup = applyWarningCurrentReception(
      connection,
      rec1,
      parseResult1.value,
      DEFAULT_WARNING_CURRENT_TARGET_AREA,
    );
    assert.equal(resultDup.applied, false);
    assert.equal((resultDup as { reason: string }).reason, 'duplicate');

    // 2. 同時刻だが hash が異なる電文 (same_version_conflict)
    const diffBodyXml = buildXml(
      'VPWS50',
      '2026-09-09T01:00:00.000Z',
      `<Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00.000Z</DateTime></Kind><!-- different comment -->`,
    );
    const diffHash = crypto.createHash('sha256').update(diffBodyXml).digest('hex');

    const recDiff: TelegramReception = {
      ...rec1,
      id: 999,
      contentHash: diffHash,
      rawBody: diffBodyXml,
    };
    const parsedDiffResult = parseWarningTelegram(
      diffBodyXml,
      recDiff,
      DEFAULT_WARNING_CURRENT_TARGET_AREA,
    );
    assert.ok(parsedDiffResult.ok);

    const resultConflict = applyWarningCurrentReception(
      connection,
      recDiff,
      parsedDiffResult.value,
      DEFAULT_WARNING_CURRENT_TARGET_AREA,
    );
    assert.equal(resultConflict.applied, false);
    assert.equal((resultConflict as { reason: string }).reason, 'same_version_conflict');

    // snapshot が変化していないこと
    const snap2 = findWarningCurrentSnapshot(connection, '1310800', 'normal')!;
    assert.equal(snap2.metadata.sourceVersion, snap1.metadata.sourceVersion);
  } finally {
    cleanup();
  }
});

test('7. normal, training, test が分離され、相互に上書きしない', () => {
  const { connection, cleanup } = createTempDb();
  try {
    const xml = `<Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>`;

    // normal
    saveAndProcessReception(connection, 'VPWS50', '2026-09-09T01:00:00Z', xml, {
      controlStatus: 'normal',
    });
    const snapNormal = findWarningCurrentSnapshot(connection, '1310800', 'normal')!;
    assert.ok(snapNormal);

    // training
    saveAndProcessReception(connection, 'VPWS50', '2026-09-09T01:00:00Z', xml, {
      controlStatus: 'training',
    });
    const snapTraining = findWarningCurrentSnapshot(connection, '1310800', 'training')!;
    assert.ok(snapTraining);

    // test
    saveAndProcessReception(connection, 'VPWS50', '2026-09-09T01:00:00Z', xml, {
      controlStatus: 'test',
    });
    const snapTest = findWarningCurrentSnapshot(connection, '1310800', 'test')!;
    assert.ok(snapTest);

    // normal が変化していないこと
    const snapNormalAfter = findWarningCurrentSnapshot(connection, '1310800', 'normal')!;
    assert.deepEqual(snapNormalAfter.items, snapNormal.items);
  } finally {
    cleanup();
  }
});

test('8. パース失敗、対象地域外、未知コード、InfoType=取消 で正常現況が空に縮退しない', () => {
  const { connection, cleanup } = createTempDb();
  try {
    // 正常な初期化
    const xml = `<Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>`;
    saveAndProcessReception(connection, 'VPWS50', '2026-09-09T01:00:00Z', xml);
    const snapBase = findWarningCurrentSnapshot(connection, '1310800', 'normal')!;

    // 1. 対象地域外
    saveAndProcessReception(connection, 'VPWW55', '2026-09-09T02:00:00Z', xml, {
      areaCode: '9999999',
      areaName: '他地域',
    });

    // 2. 未知コード
    const invalidCodeXml = `<Kind><Name>未知</Name><Code>99</Code><Status>発表</Status><DateTime>2026-09-09T02:00:00Z</DateTime></Kind>`;
    saveAndProcessReception(connection, 'VPWW55', '2026-09-09T02:00:00Z', invalidCodeXml);

    // 3. InfoType=取消
    saveAndProcessReception(connection, 'VPWW55', '2026-09-09T02:00:00Z', xml, {
      infoType: '取消',
    });

    // 現況が維持されていること
    const snapCurrent = findWarningCurrentSnapshot(connection, '1310800', 'normal')!;
    assert.deepEqual(snapCurrent.items, snapBase.items);
    assert.equal(snapCurrent.metadata.sourceVersion, snapBase.metadata.sourceVersion);
  } finally {
    cleanup();
  }
});

test('9. VPWS50 の正常な no_warning は available かつ明細0件で、未初期化と区別される', () => {
  const { connection, cleanup } = createTempDb();
  try {
    // 未初期化
    assert.equal(findWarningCurrentSnapshot(connection, '1310800', 'normal'), null);

    // no_warning の VPWS50 を処理
    const noWarnXml = `<Kind><Status>発表警報・注意報はなし</Status><DateTime type="発表時刻">2026-09-09T01:00:00Z</DateTime></Kind>`;
    saveAndProcessReception(connection, 'VPWS50', '2026-09-09T01:00:00Z', noWarnXml);

    const snapshot = findWarningCurrentSnapshot(connection, '1310800', 'normal');
    assert.ok(snapshot);
    assert.equal(snapshot.metadata.availability, 'available');
    assert.equal(snapshot.items.length, 0);
  } finally {
    cleanup();
  }
});

test('10. 受信履歴からの復旧 (rebuildWarningCurrentFromReceptions) が冪等であり、逆順受信でも同じ状態になる', () => {
  const { connection, cleanup } = createTempDb();
  try {
    // 2 つの電文を保存
    // 1. VPWS50 (01:00): 大雨注意報(10)
    // 2. VPWW55 (02:00): 大雨警報(03)
    const xml1 = `<Kind><Name>大雨注意報</Name><Code>10</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>`;
    const xml2 = `<Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status><DateTime>2026-09-09T02:00:00Z</DateTime></Kind>`;

    saveAndProcessReception(connection, 'VPWS50', '2026-09-09T01:00:00Z', xml1);
    saveAndProcessReception(connection, 'VPWW55', '2026-09-09T02:00:00Z', xml2);

    const liveSnapshot = findWarningCurrentSnapshot(connection, '1310800', 'normal')!;
    assert.equal(liveSnapshot.items[0]!.kindCode, '03');

    // 復旧を実行（1回目）
    const rebuildResult1 = rebuildWarningCurrentFromReceptions(
      connection,
      DEFAULT_WARNING_CURRENT_TARGET_AREA,
    );
    assert.equal(rebuildResult1.applied, true);

    const snapRebuilt1 = findWarningCurrentSnapshot(connection, '1310800', 'normal')!;
    assert.equal(snapRebuilt1.metadata.sourceVersion, liveSnapshot.metadata.sourceVersion);
    assert.deepEqual(
      snapRebuilt1.items.map((i) => i.kindCode),
      liveSnapshot.items.map((i) => i.kindCode),
    );

    // 復旧を実行（2回目 - 冪等性）
    const rebuildResult2 = rebuildWarningCurrentFromReceptions(
      connection,
      DEFAULT_WARNING_CURRENT_TARGET_AREA,
    );
    assert.equal(rebuildResult2.applied, true);

    const snapRebuilt2 = findWarningCurrentSnapshot(connection, '1310800', 'normal')!;
    assert.equal(snapRebuilt2.metadata.sourceVersion, liveSnapshot.metadata.sourceVersion);
  } finally {
    cleanup();
  }
});

test('AC7: 保存済み現況からの更新 - 一時 DB に保存後再接続し、10→03 は strengthened、33→03 は weakened となる', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-ac7-'));
  const databasePath = join(directory, 'test.sqlite3');

  try {
    // 1. 接続 1: 公式 Code=10 の大雨注意報 (VPWS50) を保存して接続を閉じる
    {
      const context1 = initializeDatabase({ databasePath, migrationsDirectory });
      try {
        const vpws50Xml = `<Kind><Name>大雨注意報</Name><Code>10</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>`;
        saveAndProcessReception(context1.connection, 'VPWS50', '2026-09-09T01:00:00Z', vpws50Xml);

        const snap1 = findWarningCurrentSnapshot(context1.connection, '1310800', 'normal')!;
        assert.ok(snap1);
        assert.equal(snap1.items.length, 1);
        assert.equal(snap1.items[0]!.kindCode, '10');
        assert.equal(snap1.items[0]!.kindName, '大雨注意報');
      } finally {
        context1.close();
      }
    }

    // 2. 接続 2: 再接続し、公式 Code=03 の大雨警報 (VPWW55) を処理
    {
      const context2 = initializeDatabase({ databasePath, migrationsDirectory });
      try {
        const vpww55Xml = `<Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status><DateTime>2026-09-09T02:00:00Z</DateTime><LastKind><Name>大雨注意報</Name><Code>10</Code></LastKind></Kind>`;
        const { applyResult } = saveAndProcessReception(
          context2.connection,
          'VPWW55',
          '2026-09-09T02:00:00Z',
          vpww55Xml,
        );

        assert.equal(applyResult.applied, true);
        assert.equal(applyResult.changes.length, 1);
        assert.equal(applyResult.changes[0]!.changeType, 'strengthened');
        assert.equal(applyResult.changes[0]!.phenomenonKey, 'heavy_rain');
        assert.equal(applyResult.changes[0]!.before?.kindCode, '10');
        assert.equal(applyResult.changes[0]!.before?.kindName, '大雨注意報');
        assert.equal(applyResult.changes[0]!.after?.kindCode, '03');
        assert.equal(applyResult.changes[0]!.after?.kindName, '大雨警報');

        const snap2 = findWarningCurrentSnapshot(context2.connection, '1310800', 'normal')!;
        assert.ok(snap2);
        assert.equal(snap2.items.length, 1);
        assert.equal(snap2.items[0]!.kindCode, '03');
        assert.equal(snap2.items[0]!.kindName, '大雨警報');
      } finally {
        context2.close();
      }
    }

    // 3. 逆方向 33→03 の weakened:
    // 接続 3: Code=33 の特別警報を保存して閉じる
    {
      const context3 = initializeDatabase({ databasePath, migrationsDirectory });
      try {
        const vpww55SpecialXml = `<Kind><Name>大雨特別警報</Name><Code>33</Code><Status>発表</Status><DateTime>2026-09-09T03:00:00Z</DateTime><LastKind><Name>大雨警報</Name><Code>03</Code></LastKind></Kind>`;
        saveAndProcessReception(
          context3.connection,
          'VPWW55',
          '2026-09-09T03:00:00Z',
          vpww55SpecialXml,
        );

        const snap3 = findWarningCurrentSnapshot(context3.connection, '1310800', 'normal')!;
        assert.ok(snap3);
        assert.equal(snap3.items.length, 1);
        assert.equal(snap3.items[0]!.kindCode, '33');
        assert.equal(snap3.items[0]!.kindName, '大雨特別警報');
      } finally {
        context3.close();
      }
    }

    // 接続 4: 再接続し、Code=33 から 03 へ緩和
    {
      const context4 = initializeDatabase({ databasePath, migrationsDirectory });
      try {
        const vpww55WeakenedXml = `<Kind><Name>大雨警報</Name><Code>03</Code><Status>特別警報から警報</Status><DateTime>2026-09-09T04:00:00Z</DateTime><LastKind><Name>大雨特別警報</Name><Code>33</Code></LastKind></Kind>`;
        const { applyResult } = saveAndProcessReception(
          context4.connection,
          'VPWW55',
          '2026-09-09T04:00:00Z',
          vpww55WeakenedXml,
        );

        assert.equal(applyResult.applied, true);
        assert.equal(applyResult.changes.length, 1);
        assert.equal(applyResult.changes[0]!.changeType, 'weakened');
        assert.equal(applyResult.changes[0]!.phenomenonKey, 'heavy_rain');
        assert.equal(applyResult.changes[0]!.before?.kindCode, '33');
        assert.equal(applyResult.changes[0]!.before?.kindName, '大雨特別警報');
        assert.equal(applyResult.changes[0]!.after?.kindCode, '03');
        assert.equal(applyResult.changes[0]!.after?.kindName, '大雨警報');

        const snap4 = findWarningCurrentSnapshot(context4.connection, '1310800', 'normal')!;
        assert.ok(snap4);
        assert.equal(snap4.items.length, 1);
        assert.equal(snap4.items[0]!.kindCode, '03');
        assert.equal(snap4.items[0]!.kindName, '大雨警報');
      } finally {
        context4.close();
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('AC8: 復旧と同一版 - 2 回の復旧で最終現況・sourceVersion・既存履歴件数が同一となり、受信履歴・通知履歴が増加しない', () => {
  const { connection, cleanup } = createTempDb();
  try {
    // 1. 原文を受信・保存
    const xml1 = `<Kind><Name>大雨注意報</Name><Code>10</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>`;
    const xml2 = `<Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status><DateTime>2026-09-09T02:00:00Z</DateTime></Kind>`;
    saveAndProcessReception(connection, 'VPWS50', '2026-09-09T01:00:00Z', xml1);
    saveAndProcessReception(connection, 'VPWW55', '2026-09-09T02:00:00Z', xml2);

    const getReceptionCount = () =>
      (
        connection.prepare('SELECT COUNT(*) as cnt FROM telegram_reception').get() as {
          cnt: number;
        }
      ).cnt;
    const getNotificationCount = () =>
      (
        connection.prepare('SELECT COUNT(*) as cnt FROM notification_output_history').get() as {
          cnt: number;
        }
      ).cnt;

    const initialReceptionCount = getReceptionCount();
    const initialNotificationCount = getNotificationCount();
    assert.equal(initialReceptionCount, 2);
    assert.equal(initialNotificationCount, 0);

    // 2. 1 回目の復旧
    const result1 = rebuildWarningCurrentFromReceptions(
      connection,
      DEFAULT_WARNING_CURRENT_TARGET_AREA,
    );
    assert.equal(result1.applied, true);
    const snap1 = findWarningCurrentSnapshot(connection, '1310800', 'normal')!;
    assert.ok(snap1);
    assert.equal(getReceptionCount(), initialReceptionCount);
    assert.equal(getNotificationCount(), initialNotificationCount);

    // 3. 2 回目の復旧 (同一版・冪等性)
    const result2 = rebuildWarningCurrentFromReceptions(
      connection,
      DEFAULT_WARNING_CURRENT_TARGET_AREA,
    );
    assert.equal(result2.applied, true);
    const snap2 = findWarningCurrentSnapshot(connection, '1310800', 'normal')!;
    assert.ok(snap2);

    assert.equal(snap1.metadata.sourceVersion, snap2.metadata.sourceVersion);
    assert.deepEqual(snap1.items, snap2.items);
    assert.deepEqual(snap1.metadata, snap2.metadata);
    assert.equal(getReceptionCount(), initialReceptionCount);
    assert.equal(getNotificationCount(), initialNotificationCount);
  } finally {
    cleanup();
  }
});

test('AC9: #114 統合境界 - 2会場×3 controlStatus の更新・保持・再構築回帰', async () => {
  const controlStatuses: ControlStatus[] = ['normal', 'training', 'test'];

  // 両市町村（江東区 1310800, 大田区 1311100）を含む合成 VPWS50 を作成
  function buildMultiAreaVpws50(cs: ControlStatus): string {
    const csXml = cs === 'normal' ? '通常' : cs === 'training' ? '訓練' : '試験';
    return `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
  <Control>
    <Title>気象警報・注意報</Title>
    <DateTime>2026-09-09T01:00:00Z</DateTime>
    <Status>${csXml}</Status>
    <EditorialOffice>気象庁本庁</EditorialOffice>
    <PublishingOffice>気象庁</PublishingOffice>
  </Control>
  <Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
    <Title>東京都気象警報・注意報</Title>
    <ReportDateTime>2026-09-09T01:00:00Z</ReportDateTime>
    <TargetDateTime>2026-09-09T01:00:00Z</TargetDateTime>
    <EventID>EVENT_${cs}</EventID>
    <InfoType>発表</InfoType>
    <Serial>1</Serial>
    <InfoKind>気象警報・注意報</InfoKind>
    <InfoKindVersion>1.0_1</InfoKindVersion>
    <Headline><Text>警報・注意報</Text></Headline>
  </Head>
  <Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/">
    <Warning type="気象警報・注意報（市町村等）">
      <Item>
        <Area>
          <Name>江東区</Name>
          <Code>1310800</Code>
        </Area>
        <Kind><Name>大雨注意報</Name><Code>10</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
      </Item>
      <Item>
        <Area>
          <Name>大田区</Name>
          <Code>1311100</Code>
        </Area>
        <Kind><Name>大雨注意報</Name><Code>10</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
      </Item>
    </Warning>
  </Body>
</Report>`;
  }

  const targetCombinations: Array<{ venueId: VenueId; controlStatus: ControlStatus }> = [
    { venueId: 'east', controlStatus: 'normal' },
    { venueId: 'east', controlStatus: 'training' },
    { venueId: 'east', controlStatus: 'test' },
    { venueId: 'trc', controlStatus: 'normal' },
    { venueId: 'trc', controlStatus: 'training' },
    { venueId: 'trc', controlStatus: 'test' },
  ];

  const verifiedCombinations = new Set<string>();

  for (const { venueId: targetVenueId, controlStatus: targetCs } of targetCombinations) {
    const { connection, cleanup } = createTempDb();
    try {
      // 1. 3 controlStatus で VPWS50 を受信・全会場へ適用し 6 組を初期化
      for (const cs of controlStatuses) {
        const xml = buildMultiAreaVpws50(cs);
        const hash = crypto.createHash('sha256').update(xml, 'utf8').digest('hex');
        const docUrl = `https://example.com/vpws50_${cs}.xml`;
        const reception = recordTelegramReception(connection, {
          fetchAttemptId: null,
          feedKind: 'extra',
          feedEntryId: `entry-${hash.slice(0, 8)}`,
          documentUrl: docUrl,
          telegramType: 'VPWS50',
          title: '東京都気象警報・注意報',
          controlStatus: cs,
          infoType: '発表',
          eventId: `EVENT_${cs}`,
          serial: '1',
          controlDateTime: '2026-09-09T01:00:00.000Z',
          reportDateTime: '2026-09-09T01:00:00.000Z',
          targetDateTime: '2026-09-09T01:00:00.000Z',
          receivedAt: '2026-09-09T01:00:05.000Z',
          adoptions: [],
          rawBody: xml,
          bodyBytes: Buffer.byteLength(xml, 'utf-8'),
          contentHash: hash,
          areas: [
            {
              areaCode: '1310800',
              areaName: '江東区',
              codeType: '気象警報・注意報（市町村等）',
              sequence: 1,
            },
            {
              areaCode: '1311100',
              areaName: '大田区',
              codeType: '気象警報・注意報（市町村等）',
              sequence: 2,
            },
          ],
        });

        // processWarningTelegramReceptionForAllVenues で両会場にパース・適用・採用記録
        processWarningTelegramReceptionForAllVenues(connection, reception, '2026-09-09T01:00:10Z');
      }

      // 6 組すべてが初期化され、大雨注意報(10) を持っていることを getVenueWarningCurrent で明示確認
      const initialSnapshots: Record<string, ReturnType<typeof getVenueWarningCurrent>> = {};
      for (const vId of VENUE_IDS) {
        for (const cs of controlStatuses) {
          const key = `${vId}_${cs}`;
          const snap = getVenueWarningCurrent(connection, vId, cs);
          assert.ok(snap, `Snapshot must exist for ${key}`);
          assert.equal(snap.items.length, 1);
          assert.equal(snap.items[0]!.kindCode, '10');
          assert.equal(snap.items[0]!.kindName, '大雨注意報');
          initialSnapshots[key] = snap;
        }
      }

      // 2. 対象組 (targetVenueId, targetCs) を対象にした公式 Code 10→03 の新しい VPWW55 を作成・適用
      const targetVenueContext = resolveVenueWarningContext(targetVenueId);
      const otherVenueId = targetVenueId === 'east' ? 'trc' : 'east';
      const otherVenueContext = resolveVenueWarningContext(otherVenueId);

      const targetAreaCode = targetVenueContext.targetArea.municipalCode;
      const targetAreaName = targetVenueContext.targetArea.displayName;
      const targetCsXml =
        targetCs === 'normal' ? '通常' : targetCs === 'training' ? '訓練' : '試験';

      const updateXml = buildXml(
        'VPWW55',
        '2026-09-09T02:00:00Z',
        `<Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status><DateTime>2026-09-09T02:00:00Z</DateTime><LastKind><Name>大雨注意報</Name><Code>10</Code></LastKind></Kind>`,
        { areaCode: targetAreaCode, areaName: targetAreaName, controlStatus: targetCsXml },
      );
      const updateHash = crypto.createHash('sha256').update(updateXml, 'utf8').digest('hex');
      const updateReception = recordTelegramReception(connection, {
        fetchAttemptId: null,
        feedKind: 'extra',
        feedEntryId: `entry-${updateHash.slice(0, 8)}`,
        documentUrl: `https://example.com/vpww55_${targetVenueId}_${targetCs}.xml`,
        telegramType: 'VPWW55',
        title: '東京都気象警報・注意報',
        controlStatus: targetCs,
        infoType: '発表',
        eventId: `EVENT_${targetVenueId}_${targetCs}`,
        serial: '1',
        controlDateTime: '2026-09-09T02:00:00.000Z',
        reportDateTime: '2026-09-09T02:00:00.000Z',
        targetDateTime: '2026-09-09T02:00:00.000Z',
        receivedAt: '2026-09-09T02:00:05.000Z',
        adoptions: [],
        rawBody: updateXml,
        bodyBytes: Buffer.byteLength(updateXml, 'utf-8'),
        contentHash: updateHash,
        areas: [
          {
            areaCode: targetAreaCode,
            areaName: targetAreaName,
            codeType: '気象警報・注意報（市町村等）',
            sequence: 1,
          },
        ],
      });

      // 会場別にパース結果を検証
      const targetParsed = parseWarningTelegram(
        updateReception.rawBody!,
        updateReception,
        targetVenueContext.targetArea,
      );
      const otherParsed = parseWarningTelegram(
        updateReception.rawBody!,
        updateReception,
        otherVenueContext.targetArea,
      );

      assert.equal(targetParsed.ok, true);
      assert.equal(otherParsed.ok, false);
      assert.equal(otherParsed.disposition, '対象地域外');

      // 対象組への適用差分が strengthened であることを完全一致で確認
      const applyResult = applyWarningCurrentReception(
        connection,
        updateReception,
        targetParsed.value,
        targetVenueContext.targetArea,
      );
      assert.equal(applyResult.applied, true);
      assert.equal(applyResult.changes.length, 1);
      assert.equal(applyResult.changes[0]!.changeType, 'strengthened');
      assert.equal(applyResult.changes[0]!.phenomenonKey, 'heavy_rain');
      assert.equal(applyResult.changes[0]!.before?.kindCode, '10');
      assert.equal(applyResult.changes[0]!.before?.kindName, '大雨注意報');
      assert.equal(applyResult.changes[0]!.after?.kindCode, '03');
      assert.equal(applyResult.changes[0]!.after?.kindName, '大雨警報');

      // 全会場処理の採用結果を確認（adoption 記録を最新化）
      const parseResultsAll = processWarningTelegramReceptionForAllVenues(
        connection,
        updateReception,
        '2026-09-09T02:00:10Z',
      );
      assert.equal(parseResultsAll.get(targetVenueId)!.ok, true);
      assert.equal(parseResultsAll.get(otherVenueId)!.ok, false);
      assert.equal(parseResultsAll.get(otherVenueId)!.disposition, '対象地域外');

      // 対象組のスナップショットが更新され、残り 5 組が事前値と完全一致することを確認
      const updatedTarget = getVenueWarningCurrent(connection, targetVenueId, targetCs)!;
      assert.ok(updatedTarget);
      assert.equal(updatedTarget.items[0]!.kindCode, '03');
      assert.equal(updatedTarget.items[0]!.kindName, '大雨警報');

      for (const vId of VENUE_IDS) {
        for (const cs of controlStatuses) {
          if (vId === targetVenueId && cs === targetCs) continue;
          const key = `${vId}_${cs}`;
          const current = getVenueWarningCurrent(connection, vId, cs);
          assert.deepEqual(
            current,
            initialSnapshots[key],
            `Remaining snapshot ${key} must match initial when updating ${targetVenueId}_${targetCs}`,
          );
        }
      }

      // 3. 起動と同じ再処理・再構築を 2 回実行し、冪等性を検証
      const clock = () => '2026-09-09T02:30:00Z' as UtcIso8601String;

      const runStartupRebuild = async () => {
        for (const vId of VENUE_IDS) {
          const venue = resolveVenueWarningContext(vId);
          await reprocessPendingWarningTelegramReceptions(connection, venue, clock);
          rebuildWarningCurrentFromReceptions(connection, venue.targetArea);
        }
      };

      // 1 回目
      await runStartupRebuild();

      const getAdoptionCount = () =>
        (
          connection.prepare('SELECT COUNT(*) as cnt FROM telegram_reception_adoption').get() as {
            cnt: number;
          }
        ).cnt;
      const getReceptionRows = () =>
        connection
          .prepare(
            'SELECT id, telegram_type, report_datetime, content_hash FROM telegram_reception ORDER BY id',
          )
          .all();
      const getNotificationRows = () =>
        connection.prepare('SELECT * FROM notification_output_history ORDER BY id').all();

      const snapshotsAfter1st: Record<string, ReturnType<typeof getVenueWarningCurrent>> = {};
      for (const vId of VENUE_IDS) {
        for (const cs of controlStatuses) {
          snapshotsAfter1st[`${vId}_${cs}`] = getVenueWarningCurrent(connection, vId, cs);
        }
      }
      const adoptionCount1 = getAdoptionCount();
      const receptionRows1 = getReceptionRows();
      const notificationRows1 = getNotificationRows();

      // 2 回目
      await runStartupRebuild();

      const snapshotsAfter2nd: Record<string, ReturnType<typeof getVenueWarningCurrent>> = {};
      for (const vId of VENUE_IDS) {
        for (const cs of controlStatuses) {
          snapshotsAfter2nd[`${vId}_${cs}`] = getVenueWarningCurrent(connection, vId, cs);
        }
      }
      const adoptionCount2 = getAdoptionCount();
      const receptionRows2 = getReceptionRows();
      const notificationRows2 = getNotificationRows();

      // 6 組の最終現況・sourceVersion が完全一致
      assert.deepEqual(snapshotsAfter1st, snapshotsAfter2nd);
      // 原文・通知履歴が完全一致
      assert.deepEqual(receptionRows1, receptionRows2);
      assert.deepEqual(notificationRows1, notificationRows2);
      // 初回補完後の採用行が完全一致
      assert.equal(adoptionCount1, adoptionCount2);

      verifiedCombinations.add(`${targetVenueId}_${targetCs}`);
    } finally {
      cleanup();
    }
  }

  assert.equal(verifiedCombinations.size, 6);
});
