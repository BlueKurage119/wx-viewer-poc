import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initializeDatabase } from '../src/database/index.js';
import {
  findWarningCurrentSnapshot,
  listWarningCurrentStreams,
  recordTelegramReception,
} from '../src/repositories/index.js';
import {
  applyWarningCurrentReception,
  recoverWarningCurrent,
} from '../src/polling/jmaWarningCurrentProcessor.js';
import { parseWarningTelegram } from '../src/polling/jmaWarningTelegramParser.js';
import { resolveVenueWarningContext } from '../src/venueForecastTargets.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');
const venue = resolveVenueWarningContext('east');

function createTempDb() {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-recovery-'));
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

function buildXml(input: {
  telegramType: string;
  reportDateTime: string;
  kindsXml: string;
  controlStatus?: 'normal' | 'training' | 'test';
  infoType?: string;
}): string {
  const status =
    input.controlStatus === 'training' ? '訓練' : input.controlStatus === 'test' ? '試験' : '通常';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
  <Control><Title>気象警報・注意報</Title><DateTime>${input.reportDateTime}</DateTime><Status>${status}</Status><EditorialOffice>気象庁本庁</EditorialOffice><PublishingOffice>気象庁</PublishingOffice></Control>
  <Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><Title>東京都気象警報・注意報</Title><ReportDateTime>${input.reportDateTime}</ReportDateTime><TargetDateTime>${input.reportDateTime}</TargetDateTime><EventID>EVENT1</EventID><InfoType>${input.infoType ?? '発表'}</InfoType><Serial>1</Serial><InfoKind>気象警報・注意報</InfoKind><InfoKindVersion>1.0_1</InfoKindVersion><Headline><Text>警報・注意報</Text></Headline></Head>
  <Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/"><Warning type="気象警報・注意報（市町村等）"><Item><Area><Name>江東区</Name><Code>1310800</Code></Area>${input.kindsXml}</Item></Warning></Body>
</Report>`;
}

function save(input: {
  connection: ReturnType<typeof initializeDatabase>['connection'];
  telegramType: string;
  reportDateTime: string;
  kindsXml: string;
  controlStatus?: 'normal' | 'training' | 'test';
  infoType?: string;
  apply?: boolean;
  urlSuffix?: string;
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
        areaCode: '1310800',
        areaName: '江東区',
        codeType: '気象警報・注意報（市町村等）',
        sequence: 1,
      },
    ],
  });
  const parsed = parseWarningTelegram(rawBody, reception, venue.targetArea);
  assert.equal(parsed.ok, true);
  if (parsed.ok && input.apply !== false) {
    applyWarningCurrentReception(input.connection, reception, parsed.value, venue.targetArea);
  }
  return reception;
}

const rainAdvisory = `<Kind><Name>大雨注意報</Name><Code>10</Code><Status>発表</Status><DateTime>2026-09-09T01:00:00Z</DateTime></Kind>`;
const rainWarning = `<Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status><DateTime>2026-09-09T02:00:00Z</DateTime><LastKind><Name>大雨注意報</Name><Code>10</Code></LastKind></Kind>`;

function logicalSnapshot(
  connection: ReturnType<typeof initializeDatabase>['connection'],
  status = 'normal',
) {
  const snapshot = findWarningCurrentSnapshot(connection, '1310800', status as 'normal');
  if (!snapshot) return null;
  return {
    areaCode: snapshot.areaCode,
    areaName: snapshot.areaName,
    metadata: snapshot.metadata,
    telegram: snapshot.telegram,
    items: snapshot.items.map(({ id, ...item }) => {
      void id;
      return item;
    }),
  };
}

test('AC1: 整合した保存済み状態は履歴探索せず再利用する', async () => {
  const { connection, cleanup } = createTempDb();
  try {
    const reception = save({
      connection,
      telegramType: 'VPWS50',
      reportDateTime: '2026-09-09T01:00:00.000Z',
      kindsXml: rainAdvisory,
    });
    const result = await recoverWarningCurrent(connection, venue, {
      yieldEveryParsedReceptions: 100,
    });
    const normal = result.statuses.find((entry) => entry.controlStatus === 'normal')!;
    assert.equal(normal.outcome, 'reused');
    assert.deepEqual(normal.selectedReceptionIds, [reception.id]);
    assert.equal(normal.parsedReceptionCount, 1);
  } finally {
    cleanup();
  }
});

test('AC2: 不整合なtrainingだけを再構築し、正常なnormalを保持する', async () => {
  const { connection, cleanup } = createTempDb();
  try {
    save({
      connection,
      telegramType: 'VPWS50',
      reportDateTime: '2026-09-09T01:00:00.000Z',
      kindsXml: rainAdvisory,
    });
    save({
      connection,
      telegramType: 'VPWS50',
      reportDateTime: '2026-09-09T01:00:00.000Z',
      kindsXml: rainAdvisory,
      controlStatus: 'training',
    });
    const normalBefore = listWarningCurrentStreams(connection, '130000', '1310800', 'normal');
    connection
      .prepare(
        "DELETE FROM warning_current_stream WHERE area_code = '1310800' AND control_status = 'training'",
      )
      .run();

    const result = await recoverWarningCurrent(connection, venue, {
      yieldEveryParsedReceptions: 100,
    });
    assert.equal(
      result.statuses.find((entry) => entry.controlStatus === 'normal')?.outcome,
      'reused',
    );
    assert.equal(
      result.statuses.find((entry) => entry.controlStatus === 'training')?.outcome,
      'rebuilt',
    );
    assert.deepEqual(
      listWarningCurrentStreams(connection, '130000', '1310800', 'normal'),
      normalBefore,
    );
  } finally {
    cleanup();
  }
});

test('AC4・AC5: fallback後も個別電文による訂正結果とsourceVersionを保存する', async () => {
  const { connection, cleanup } = createTempDb();
  try {
    save({
      connection,
      telegramType: 'VPWS50',
      reportDateTime: '2026-09-09T01:00:00.000Z',
      kindsXml: rainAdvisory,
    });
    save({
      connection,
      telegramType: 'VPWW55',
      reportDateTime: '2026-09-09T02:00:00.000Z',
      kindsXml: rainWarning,
    });
    const before = logicalSnapshot(connection);
    connection
      .prepare(
        "DELETE FROM warning_current_stream WHERE area_code = '1310800' AND control_status = 'normal'",
      )
      .run();

    const result = await recoverWarningCurrent(connection, venue, {
      yieldEveryParsedReceptions: 1,
    });
    assert.equal(
      result.statuses.find((entry) => entry.controlStatus === 'normal')?.outcome,
      'rebuilt',
    );
    assert.deepEqual(logicalSnapshot(connection), before);
    assert.equal(
      findWarningCurrentSnapshot(connection, '1310800', 'normal')?.items[0]?.kindCode,
      '03',
    );
  } finally {
    cleanup();
  }
});

test('AC6: VPWS50がないstatusは個別ストリームを保持したuninitializedになる', async () => {
  const { connection, cleanup } = createTempDb();
  try {
    save({
      connection,
      telegramType: 'VPWW55',
      reportDateTime: '2026-09-09T02:00:00.000Z',
      kindsXml: rainWarning,
      apply: false,
    });
    const result = await recoverWarningCurrent(connection, venue, {
      yieldEveryParsedReceptions: 100,
    });
    const normal = result.statuses.find((entry) => entry.controlStatus === 'normal')!;
    assert.equal(normal.outcome, 'uninitialized');
    assert.equal(findWarningCurrentSnapshot(connection, '1310800', 'normal'), null);
    assert.deepEqual(
      listWarningCurrentStreams(connection, '130000', '1310800', 'normal').map(
        (entry) => entry.telegramType,
      ),
      ['VPWW55'],
    );
  } finally {
    cleanup();
  }
});

test('AC7: 探索中の同版競合では対象statusを書き換えない', async () => {
  const { connection, cleanup } = createTempDb();
  try {
    save({
      connection,
      telegramType: 'VPWS50',
      reportDateTime: '2026-09-09T01:00:00.000Z',
      kindsXml: rainAdvisory,
    });
    connection
      .prepare(
        "UPDATE warning_current_stream SET content_hash = 'broken' WHERE area_code = '1310800' AND control_status = 'normal'",
      )
      .run();
    save({
      connection,
      telegramType: 'VPWS50',
      reportDateTime: '2026-09-09T03:00:00.000Z',
      kindsXml: rainAdvisory,
      apply: false,
      urlSuffix: 'a',
    });
    save({
      connection,
      telegramType: 'VPWS50',
      reportDateTime: '2026-09-09T03:00:00.000Z',
      kindsXml: rainWarning,
      apply: false,
      urlSuffix: 'b',
    });
    const streamsBefore = listWarningCurrentStreams(connection, '130000', '1310800', 'normal');
    const snapshotBefore = logicalSnapshot(connection);

    await assert.rejects(
      recoverWarningCurrent(connection, venue, { yieldEveryParsedReceptions: 100 }),
      /同版競合/,
    );
    assert.deepEqual(
      listWarningCurrentStreams(connection, '130000', '1310800', 'normal'),
      streamsBefore,
    );
    assert.deepEqual(logicalSnapshot(connection), snapshotBefore);
  } finally {
    cleanup();
  }
});

test('AC7: XML解析件数の閾値とcontrolStatus境界でイベントループへ制御を返す', async () => {
  const { connection, cleanup } = createTempDb();
  try {
    save({
      connection,
      telegramType: 'VPWS50',
      reportDateTime: '2026-09-09T01:00:00.000Z',
      kindsXml: rainAdvisory,
    });
    let yieldCount = 0;
    await recoverWarningCurrent(connection, venue, {
      yieldEveryParsedReceptions: 1,
      yieldControl: async () => {
        yieldCount += 1;
      },
    });
    assert.ok(yieldCount >= 4, `解析閾値1回と3 status境界以上のyieldを期待: ${yieldCount}`);
  } finally {
    cleanup();
  }
});
