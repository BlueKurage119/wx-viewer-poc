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
  listWarningCurrentStreams,
  recordTelegramReception,
  type TelegramReception,
} from '../src/repositories/index.js';
import {
  applyWarningCurrentReception,
  DEFAULT_WARNING_CURRENT_TARGET_AREA,
  rebuildWarningCurrentFromReceptions,
} from '../src/polling/jmaWarningCurrentProcessor.js';
import { processWarningTelegramReception } from '../src/polling/jmaWarningTelegramProcessor.js';
import { parseWarningTelegram } from '../src/polling/jmaWarningTelegramParser.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');

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
    adoptionResult: null,
    adoptionReason: null,
    adoptionDecidedAt: null,
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

  const parseResult = processWarningTelegramReception(
    connection,
    reception,
    isoReceived,
    DEFAULT_WARNING_CURRENT_TARGET_AREA,
  );

  return { reception, parseResult };
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

test('2. 個別受信後に古い要素時刻の VPWS50 が届いても、個別の新しい大雨を保持して初期化される', () => {
  const { connection, cleanup } = createTempDb();
  try {
    // 先に VPWW55 (大雨警報 03, report 02:00) を受信
    const vpww55Xml = `<Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status><DateTime>2026-09-09T02:00:00Z</DateTime></Kind>`;
    saveAndProcessReception(connection, 'VPWW55', '2026-09-09T02:00:00Z', vpww55Xml);

    // 後から届いた VPWS50 (大雨注意報 33, 要素時刻 01:00, レポート時刻 02:00)
    const vpws50Xml = `
      <Kind><Name>大雨注意報</Name><Code>33</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
      <Kind><Name>高潮注意報</Name><Code>38</Code><Status>発表</Status><DateTime>2026-09-09T01:30:00Z</DateTime></Kind>
    `;
    saveAndProcessReception(connection, 'VPWS50', '2026-09-09T02:00:00Z', vpws50Xml);

    const snapshot = findWarningCurrentSnapshot(connection, '1310800', 'normal');
    assert.ok(snapshot);
    assert.equal(snapshot.metadata.availability, 'available');
    assert.equal(snapshot.items.length, 2);

    // 個別の 03 (大雨警報) が保持され、集約の 38 (高潮注意報) が合成されている
    assert.equal(snapshot.items[0]!.kindCode, '03');
    assert.equal(snapshot.items[0]!.sourceTelegram, 'VPWW55');
    assert.equal(snapshot.items[1]!.kindCode, '38');
    assert.equal(snapshot.items[1]!.sourceTelegram, 'VPWS50');
  } finally {
    cleanup();
  }
});

test('3. VPWS50 初期化後、VPWW55 の Code=00 解除で大雨だけが消え、高潮・雷は残る', () => {
  const { connection, cleanup } = createTempDb();
  try {
    // VPWS50: 大雨警報(03), 高潮注意報(38), 雷注意報(14)
    const baseXml = `
      <Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
      <Kind><Name>高潮注意報</Name><Code>38</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
      <Kind><Name>雷注意報</Name><Code>14</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
    `;
    saveAndProcessReception(connection, 'VPWS50', '2026-09-09T01:00:00Z', baseXml);

    // VPWW55: Code=00 全解除 (02:00)
    const releaseXml = `<Kind><Name>解除</Name><Code>00</Code><Status>解除</Status><DateTime>2026-09-09T02:00:00Z</DateTime></Kind>`;
    saveAndProcessReception(connection, 'VPWW55', '2026-09-09T02:00:00Z', releaseXml);

    const snapshot = findWarningCurrentSnapshot(connection, '1310800', 'normal');
    assert.ok(snapshot);
    assert.equal(snapshot.items.length, 2);
    assert.equal(snapshot.items[0]!.kindCode, '38');
    assert.equal(snapshot.items[1]!.kindCode, '14');
  } finally {
    cleanup();
  }
});

test('4. 高潮実電文構造: VPWW57 で 48 へ強化され、VPWS50 (Code=48 解除) で高潮だけが解除される', () => {
  const { connection, cleanup } = createTempDb();
  try {
    // 1. 初期 VPWS50: 高潮警報(08), 大雨注意報(33) (01:00)
    const initXml = `
      <Kind><Name>大雨注意報</Name><Code>33</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>
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
      <Kind><Name>大雨注意報</Name><Code>33</Code><Status>継続</Status><DateTime>2026-09-09T03:00:00Z</DateTime></Kind>
      <Kind><Name>高潮危険警報</Name><Code>48</Code><Status>解除</Status><DateTime>2026-09-09T03:00:00Z</DateTime><LastKind><Name>高潮危険警報</Name><Code>48</Code></LastKind></Kind>
    `;
    saveAndProcessReception(connection, 'VPWS50', '2026-09-09T03:00:00Z', vpws50Release);

    const snap3 = findWarningCurrentSnapshot(connection, '1310800', 'normal');
    assert.ok(snap3);
    assert.equal(snap3.items.length, 1);
    assert.equal(snap3.items[0]!.kindCode, '33'); // 大雨注意報だけが残る
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
    // 1. VPWS50 (01:00): 大雨注意報(33)
    // 2. VPWW55 (02:00): 大雨警報(03)
    const xml1 = `<Kind><Name>大雨注意報</Name><Code>33</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>`;
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
