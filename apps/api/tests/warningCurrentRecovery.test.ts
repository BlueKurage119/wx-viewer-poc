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
  connection: ReturnType<typeof initializeDatabase>['connection'];
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

function recoveryDump(connection: ReturnType<typeof initializeDatabase>['connection']) {
  return {
    streams: connection.prepare('SELECT * FROM warning_current_stream ORDER BY id').all(),
    snapshots: connection.prepare('SELECT * FROM warning_current_snapshot ORDER BY id').all(),
    items: connection.prepare('SELECT * FROM warning_current_item ORDER BY id').all(),
  };
}

function logicalRecoveryState(connection: ReturnType<typeof initializeDatabase>['connection']) {
  return {
    streams: listWarningCurrentStreams(connection, '130000', '1310800', 'normal').map(
      ({ id, ...stream }) => {
        void id;
        return stream;
      },
    ),
    snapshot: logicalSnapshot(connection),
  };
}

test('AC1: 3 statusの整合した保存済み状態は候補探索せず完全再利用し、DB dumpも不変', async () => {
  const { connection, cleanup } = createTempDb();
  try {
    const receptions = (['normal', 'training', 'test'] as const).map((controlStatus) =>
      save({
        connection,
        telegramType: 'VPWS50',
        reportDateTime: '2026-09-09T01:00:00.000Z',
        kindsXml: rainAdvisory,
        controlStatus,
      }),
    );
    const before = recoveryDump(connection);
    const phases: string[] = [];
    let validationYieldCount = 0;
    const result = await recoverWarningCurrent(connection, venue, {
      yieldEveryParsedReceptions: 1,
      yieldControl: async () => {
        validationYieldCount += 1;
      },
      onProgress: ({ phase }) => phases.push(phase),
    });
    assert.deepEqual(
      result.statuses.map(({ controlStatus, outcome, selectedReceptionIds }) => ({
        controlStatus,
        outcome,
        selectedReceptionIds,
      })),
      receptions.map((reception, index) => ({
        controlStatus: (['normal', 'training', 'test'] as const)[index],
        outcome: 'reused',
        selectedReceptionIds: [reception.id],
      })),
    );
    assert.equal(result.parsedReceptionCount, 3);
    assert.ok(
      validationYieldCount >= 6,
      `保存済み解析3回とstatus境界3回以上のyieldを期待: ${validationYieldCount}`,
    );
    assert.equal(phases.includes('searching'), false, '候補探索は0回');
    assert.deepEqual(recoveryDump(connection), before);
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

test('AC2: 別会場の復旧はeastの3 statusのdumpを変更しない', async () => {
  const { connection, cleanup } = createTempDb();
  try {
    for (const controlStatus of ['normal', 'training', 'test'] as const) {
      save({
        connection,
        telegramType: 'VPWS50',
        reportDateTime: '2026-09-09T01:00:00.000Z',
        kindsXml: rainAdvisory,
        controlStatus,
      });
    }
    const eastBefore = recoveryDump(connection);
    const result = await recoverWarningCurrent(connection, resolveVenueWarningContext('trc'), {
      yieldEveryParsedReceptions: 25,
    });
    assert.deepEqual(
      result.statuses.map(({ controlStatus, outcome }) => ({ controlStatus, outcome })),
      (['normal', 'training', 'test'] as const).map((controlStatus) => ({
        controlStatus,
        outcome: 'uninitialized',
      })),
    );
    assert.deepEqual(recoveryDump(connection), eastBefore);
  } finally {
    cleanup();
  }
});

test('AC3: 発表から訂正への意味とdumpをfallback後も保存する', async () => {
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
      reportDateTime: '2026-09-09T02:00:00.000Z',
      kindsXml: rainWarning,
      infoType: '訂正',
    });
    const expected = logicalSnapshot(connection);
    assert.equal(expected?.telegram.infoType, '訂正');
    connection.prepare("DELETE FROM warning_current_stream WHERE control_status = 'normal'").run();

    const result = await recoverWarningCurrent(connection, venue, {
      yieldEveryParsedReceptions: 25,
    });
    assert.equal(result.statuses[0]?.outcome, 'rebuilt');
    assert.deepEqual(logicalSnapshot(connection), expected);
  } finally {
    cleanup();
  }
});

test('AC3: 個別取消は対象現象を復活させず、fallback前後のdumpが一致する', async () => {
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
    save({
      connection,
      telegramType: 'VPWW55',
      reportDateTime: '2026-09-09T03:00:00.000Z',
      kindsXml: rainWarning,
      infoType: '取消',
    });
    const expected = logicalSnapshot(connection);
    assert.deepEqual(expected?.items, []);
    connection.prepare("DELETE FROM warning_current_stream WHERE control_status = 'normal'").run();
    await recoverWarningCurrent(connection, venue, { yieldEveryParsedReceptions: 25 });
    assert.deepEqual(logicalSnapshot(connection), expected);
  } finally {
    cleanup();
  }
});

test('AC3: VPWS50取消は空の現況を維持し、fallback前後のdumpが一致する', async () => {
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
      reportDateTime: '2026-09-09T02:00:00.000Z',
      kindsXml: rainAdvisory,
      infoType: '取消',
    });
    const expected = logicalSnapshot(connection);
    assert.deepEqual(expected?.items, []);
    assert.equal(expected?.telegram.infoType, '取消');
    connection.prepare("DELETE FROM warning_current_stream WHERE control_status = 'normal'").run();
    await recoverWarningCurrent(connection, venue, { yieldEveryParsedReceptions: 25 });
    assert.deepEqual(logicalSnapshot(connection), expected);
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

test('AC6: 保存状態も受信履歴も全欠損なら3 statusすべてuninitializedになる', async () => {
  const { connection, cleanup } = createTempDb();
  try {
    const result = await recoverWarningCurrent(connection, venue, {
      yieldEveryParsedReceptions: 25,
    });
    assert.deepEqual(
      result.statuses.map(({ controlStatus, outcome, selectedReceptionIds }) => ({
        controlStatus,
        outcome,
        selectedReceptionIds,
      })),
      (['normal', 'training', 'test'] as const).map((controlStatus) => ({
        controlStatus,
        outcome: 'uninitialized',
        selectedReceptionIds: [],
      })),
    );
    assert.deepEqual(recoveryDump(connection), { streams: [], snapshots: [], items: [] });
  } finally {
    cleanup();
  }
});

test('AC4: 同版同hashは重複として許容し、同一候補を選んで再構築する', async () => {
  const { connection, cleanup } = createTempDb();
  try {
    const first = save({
      connection,
      telegramType: 'VPWS50',
      reportDateTime: '2026-09-09T03:00:00.000Z',
      kindsXml: rainAdvisory,
      apply: false,
      urlSuffix: 'same-a',
    });
    const second = save({
      connection,
      telegramType: 'VPWS50',
      reportDateTime: '2026-09-09T03:00:00.000Z',
      kindsXml: rainAdvisory,
      apply: false,
      urlSuffix: 'same-b',
    });
    assert.equal(first.contentHash, second.contentHash);
    const result = await recoverWarningCurrent(connection, venue, {
      yieldEveryParsedReceptions: 25,
    });
    assert.equal(result.statuses[0]?.outcome, 'rebuilt');
    assert.equal(result.statuses[0]?.selectedReceptionIds.length, 1);
    assert.equal(
      [first.id, second.id].includes(result.statuses[0]!.selectedReceptionIds[0]!),
      true,
    );
    assert.equal(logicalSnapshot(connection)?.items[0]?.kindCode, '10');
  } finally {
    cleanup();
  }
});

test('AC4: 同版異hashの競合では対象statusを書き換えない', async () => {
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

for (const corruption of [
  'stream指し先欠損',
  'rawBody欠損',
  'hash不一致',
  'snapshot欠損',
  'items不一致',
] as const) {
  test(`AC5: ${corruption}を検出して履歴から期待dumpへ復旧する`, async () => {
    const { connection, cleanup } = createTempDb();
    try {
      save({
        connection,
        telegramType: 'VPWS50',
        reportDateTime: '2026-09-09T01:00:00.000Z',
        kindsXml: rainAdvisory,
      });
      const expected = logicalRecoveryState(connection);
      switch (corruption) {
        case 'stream指し先欠損':
          connection.pragma('foreign_keys = OFF');
          connection
            .prepare(
              "UPDATE warning_current_stream SET reception_id = 999999 WHERE control_status = 'normal'",
            )
            .run();
          connection.pragma('foreign_keys = ON');
          break;
        case 'rawBody欠損':
          connection.prepare('UPDATE telegram_reception SET raw_body = NULL').run();
          break;
        case 'hash不一致':
          connection.prepare("UPDATE warning_current_stream SET content_hash = 'broken'").run();
          break;
        case 'snapshot欠損':
          connection
            .prepare("DELETE FROM warning_current_snapshot WHERE control_status = 'normal'")
            .run();
          break;
        case 'items不一致':
          connection.prepare("UPDATE warning_current_item SET kind_name = '破損した項目'").run();
          break;
      }

      const result = await recoverWarningCurrent(connection, venue, {
        yieldEveryParsedReceptions: 25,
      });
      if (corruption === 'rawBody欠損') {
        assert.equal(result.statuses[0]?.outcome, 'uninitialized');
        assert.deepEqual(logicalRecoveryState(connection), { streams: [], snapshot: null });
      } else {
        assert.equal(result.statuses[0]?.outcome, 'rebuilt');
        assert.deepEqual(logicalRecoveryState(connection), expected);
      }
    } finally {
      cleanup();
    }
  });
}

test('AC7: 251件の候補を25件ずつ解析して10回以上イベントループへ制御を返す', async () => {
  const { connection, cleanup } = createTempDb();
  try {
    for (let index = 0; index < 250; index += 1) {
      save({
        connection,
        telegramType: 'VPWS50',
        reportDateTime: new Date(Date.UTC(2026, 8, 10, 0, 0, 0) - index * 1_000).toISOString(),
        kindsXml: rainAdvisory,
        apply: false,
        areaCode: '9999999',
        areaName: '対象外',
        expectParse: false,
        urlSuffix: `outside-${index}`,
      });
    }
    save({
      connection,
      telegramType: 'VPWS50',
      reportDateTime: '2026-09-09T00:00:00.000Z',
      kindsXml: rainAdvisory,
      apply: false,
      urlSuffix: 'target',
    });
    let yieldCount = 0;
    const result = await recoverWarningCurrent(connection, venue, {
      yieldEveryParsedReceptions: 25,
      candidatePageSize: 25,
      yieldControl: async () => {
        yieldCount += 1;
      },
    });
    assert.equal(result.statuses[0]?.parsedReceptionCount, 251);
    assert.ok(yieldCount >= 10, `25件ごとに10回以上のyieldを期待: ${yieldCount}`);
  } finally {
    cleanup();
  }
});

test('AC7: commit中の例外はstatus全体をrollbackし、DB再起動後に再復旧できる', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-recovery-rollback-'));
  const databasePath = join(directory, 'test.sqlite3');
  let context = initializeDatabase({ databasePath, migrationsDirectory });
  try {
    save({
      connection: context.connection,
      telegramType: 'VPWS50',
      reportDateTime: '2026-09-09T01:00:00.000Z',
      kindsXml: rainAdvisory,
    });
    context.connection
      .prepare(
        "UPDATE warning_current_stream SET content_hash = 'broken' WHERE control_status = 'normal'",
      )
      .run();
    const before = recoveryDump(context.connection);
    context.connection.exec(`
      CREATE TRIGGER fail_warning_recovery_insert
      BEFORE INSERT ON warning_current_stream
      BEGIN
        SELECT RAISE(ABORT, 'injected recovery failure');
      END
    `);

    await assert.rejects(
      recoverWarningCurrent(context.connection, venue, { yieldEveryParsedReceptions: 25 }),
      /injected recovery failure/,
    );
    assert.deepEqual(recoveryDump(context.connection), before);

    context.close();
    context = initializeDatabase({ databasePath, migrationsDirectory });
    assert.deepEqual(recoveryDump(context.connection), before, '再起動後も中間状態を残さない');
    context.connection.exec('DROP TRIGGER fail_warning_recovery_insert');
    const result = await recoverWarningCurrent(context.connection, venue, {
      yieldEveryParsedReceptions: 25,
    });
    assert.equal(result.statuses[0]?.outcome, 'rebuilt');
    assert.equal(
      listWarningCurrentStreams(context.connection, '130000', '1310800', 'normal')[0]
        ?.contentHash === 'broken',
      false,
    );
  } finally {
    context.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
