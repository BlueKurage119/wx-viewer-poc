import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VENUE_IDS } from '@wx-viewer-poc/shared';

import { initializeDatabase, type DatabaseConnection } from '../src/database/index.js';
import {
  findTelegramReceptionById,
  listPendingWarningTelegramReceptions,
  listTelegramReceptions,
  recordTelegramReception,
} from '../src/repositories/telegramReceptionRepository.js';
import { findWarningCurrentSnapshot } from '../src/repositories/warningCurrentRepository.js';
import { listWarningCurrentStreams } from '../src/repositories/warningCurrentStreamRepository.js';
import { listNotificationOutputHistory } from '../src/repositories/notificationOutputHistoryRepository.js';
import type { TelegramReceptionInput } from '../src/repositories/types.js';
import {
  processWarningTelegramReception,
  reprocessPendingWarningTelegramReceptions,
} from '../src/polling/jmaWarningTelegramProcessor.js';
import { rebuildWarningCurrentFromReceptions } from '../src/polling/jmaWarningCurrentProcessor.js';
import { resolveVenueWarningContext } from '../src/venueForecastTargets.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');

const EAST_VENUE = resolveVenueWarningContext('east');
const TRC_VENUE = resolveVenueWarningContext('trc');

function setupDb(): { connection: DatabaseConnection; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-venue-adoption-'));
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

/** 江東区(1310800)・大田区(1311100)の Item を両方（または片方）含む VPWS50 電文を組み立てる。 */
function buildVpws50Xml(
  items: ReadonlyArray<{ readonly areaCode: string; readonly areaName: string }>,
  reportDateTime = '2026-09-09T00:00:00Z',
): string {
  const itemsXml = items
    .map(
      (item) => `
      <Item>
        <Kind><Name>大雨警報</Name><Code>03</Code><Status>発表</Status></Kind>
        <Area><Name>${item.areaName}</Name><Code>${item.areaCode}</Code></Area>
      </Item>`,
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
  <Control>
    <Title>気象警報・注意報</Title>
    <DateTime>${reportDateTime}</DateTime>
    <Status>通常</Status>
    <EditorialOffice>気象庁本庁</EditorialOffice>
    <PublishingOffice>気象庁</PublishingOffice>
  </Control>
  <Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
    <Title>東京都気象警報・注意報</Title>
    <ReportDateTime>${reportDateTime}</ReportDateTime>
    <TargetDateTime>${reportDateTime}</TargetDateTime>
    <EventID>EVENT-VENUE-SCOPED</EventID>
    <InfoType>発表</InfoType>
    <Serial>1</Serial>
    <InfoKind>気象警報・注意報</InfoKind>
    <InfoKindVersion>1.0_1</InfoKindVersion>
    <Headline><Text>警報・注意報</Text></Headline>
  </Head>
  <Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/">
    <Warning type="気象警報・注意報（市町村等）">${itemsXml}
    </Warning>
  </Body>
</Report>`;
}

function saveReception(
  connection: DatabaseConnection,
  rawXml: string,
  documentUrl: string,
): ReturnType<typeof recordTelegramReception> {
  const input: TelegramReceptionInput = {
    fetchAttemptId: null,
    feedKind: 'extra',
    feedEntryId: `entry-${documentUrl}`,
    documentUrl,
    telegramType: 'VPWS50',
    title: '東京都気象警報・注意報',
    controlStatus: 'normal',
    infoType: '発表',
    eventId: 'EVENT-VENUE-SCOPED',
    serial: '1',
    controlDateTime: '2026-09-09T00:00:00.000Z',
    reportDateTime: '2026-09-09T00:00:00.000Z',
    targetDateTime: '2026-09-09T00:00:00.000Z',
    receivedAt: '2026-09-09T00:00:01.000Z',
    rawBody: rawXml,
    bodyBytes: Buffer.byteLength(rawXml, 'utf-8'),
    contentHash: `hash-${documentUrl}`,
    areas: [],
    adoptions: [],
  };
  return recordTelegramReception(connection, input);
}

// -------------------------------------------------------------------------------------------------
// §7-2. 同一電文の会場独立: 江東区・大田区の両 Item を含む同一受信を east→trc、trc→east の両順序で処理しても
// 結果が順序に依存しない。
// -------------------------------------------------------------------------------------------------
test('§7-2 同一電文の会場独立: east→trc と trc→east の処理順序で adoptions の内容が一致する', () => {
  const rawXml = buildVpws50Xml([
    { areaCode: '1310800', areaName: '江東区' },
    { areaCode: '1311100', areaName: '大田区' },
  ]);

  // east -> trc の順
  const dbA = setupDb();
  let adoptionsOrderA;
  try {
    const reception = saveReception(dbA.connection, rawXml, 'https://example.test/both-a.xml');
    processWarningTelegramReception(dbA.connection, reception, '2026-09-09T00:01:00Z', EAST_VENUE);
    processWarningTelegramReception(dbA.connection, reception, '2026-09-09T00:02:00Z', TRC_VENUE);
    adoptionsOrderA = findTelegramReceptionById(dbA.connection, reception.id)?.adoptions;
  } finally {
    dbA.cleanup();
  }

  // trc -> east の順
  const dbB = setupDb();
  let adoptionsOrderB;
  try {
    const reception = saveReception(dbB.connection, rawXml, 'https://example.test/both-b.xml');
    processWarningTelegramReception(dbB.connection, reception, '2026-09-09T00:02:00Z', TRC_VENUE);
    processWarningTelegramReception(dbB.connection, reception, '2026-09-09T00:01:00Z', EAST_VENUE);
    adoptionsOrderB = findTelegramReceptionById(dbB.connection, reception.id)?.adoptions;
  } finally {
    dbB.cleanup();
  }

  assert.equal(adoptionsOrderA?.length, 2);
  assert.deepEqual(
    adoptionsOrderA?.map((a) => ({ venueId: a.venueId, adoptionResult: a.adoptionResult })),
    [
      { venueId: 'east', adoptionResult: '警報・注意報として解析済み' },
      { venueId: 'trc', adoptionResult: '警報・注意報として解析済み' },
    ],
  );
  // 処理順序を入れ替えても venueId 昇順で内容が完全一致する（decidedAt はそれぞれ自分の呼び出し時刻のため個別に比較）
  assert.deepEqual(
    adoptionsOrderB?.map((a) => ({
      venueId: a.venueId,
      adoptionResult: a.adoptionResult,
      adoptionReason: a.adoptionReason,
    })),
    adoptionsOrderA?.map((a) => ({
      venueId: a.venueId,
      adoptionResult: a.adoptionResult,
      adoptionReason: a.adoptionReason,
    })),
  );
});

// -------------------------------------------------------------------------------------------------
// §7-3. 対象地域外の独立: 江東区のみの電文は east で採用・trc で対象地域外、大田区のみの電文はその逆になる。
// -------------------------------------------------------------------------------------------------
test('§7-3 対象地域外の独立: 単一区域のみの電文は対象会場でのみ採用され、他会場は対象地域外になる', () => {
  const db = setupDb();
  try {
    const kotoXml = buildVpws50Xml([{ areaCode: '1310800', areaName: '江東区' }]);
    const kotoReception = saveReception(db.connection, kotoXml, 'https://example.test/koto.xml');
    processWarningTelegramReception(
      db.connection,
      kotoReception,
      '2026-09-09T00:01:00Z',
      EAST_VENUE,
    );
    processWarningTelegramReception(
      db.connection,
      kotoReception,
      '2026-09-09T00:01:00Z',
      TRC_VENUE,
    );
    const kotoAdoptions = findTelegramReceptionById(db.connection, kotoReception.id)?.adoptions;
    assert.deepEqual(
      kotoAdoptions?.map((a) => ({ venueId: a.venueId, adoptionResult: a.adoptionResult })),
      [
        { venueId: 'east', adoptionResult: '警報・注意報として解析済み' },
        { venueId: 'trc', adoptionResult: '対象地域外' },
      ],
    );

    const otaXml = buildVpws50Xml([{ areaCode: '1311100', areaName: '大田区' }]);
    const otaReception = saveReception(db.connection, otaXml, 'https://example.test/ota.xml');
    processWarningTelegramReception(
      db.connection,
      otaReception,
      '2026-09-09T00:01:00Z',
      EAST_VENUE,
    );
    processWarningTelegramReception(db.connection, otaReception, '2026-09-09T00:01:00Z', TRC_VENUE);
    const otaAdoptions = findTelegramReceptionById(db.connection, otaReception.id)?.adoptions;
    assert.deepEqual(
      otaAdoptions?.map((a) => ({ venueId: a.venueId, adoptionResult: a.adoptionResult })),
      [
        { venueId: 'east', adoptionResult: '対象地域外' },
        { venueId: 'trc', adoptionResult: '警報・注意報として解析済み' },
      ],
    );
  } finally {
    db.cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// §7-4. C3 のキー分離: 両会場処理後、warning_current_snapshot / warning_current_stream が
// area_code 1310800 と 1311100 の行に分かれ、互いの項目を上書きしない。
// -------------------------------------------------------------------------------------------------
test('§7-4 C3 のキー分離: 両会場を処理すると area_code 1310800 と 1311100 の現況・ストリームが分かれる', () => {
  const db = setupDb();
  try {
    const rawXml = buildVpws50Xml([
      { areaCode: '1310800', areaName: '江東区' },
      { areaCode: '1311100', areaName: '大田区' },
    ]);
    const reception = saveReception(db.connection, rawXml, 'https://example.test/both-c3.xml');
    processWarningTelegramReception(db.connection, reception, '2026-09-09T00:01:00Z', EAST_VENUE);
    processWarningTelegramReception(db.connection, reception, '2026-09-09T00:02:00Z', TRC_VENUE);

    const eastSnapshot = findWarningCurrentSnapshot(db.connection, '1310800', 'normal');
    const trcSnapshot = findWarningCurrentSnapshot(db.connection, '1311100', 'normal');
    assert.ok(eastSnapshot);
    assert.ok(trcSnapshot);
    assert.equal(eastSnapshot.areaCode, '1310800');
    assert.equal(eastSnapshot.areaName, '江東区');
    assert.equal(trcSnapshot.areaCode, '1311100');
    assert.equal(trcSnapshot.areaName, '大田区');
    assert.equal(eastSnapshot.items.length, 1);
    assert.equal(trcSnapshot.items.length, 1);
    assert.equal(eastSnapshot.items[0]!.kindCode, '03');
    assert.equal(trcSnapshot.items[0]!.kindCode, '03');

    const eastStreams = listWarningCurrentStreams(db.connection, '130000', '1310800', 'normal');
    const trcStreams = listWarningCurrentStreams(db.connection, '130000', '1311100', 'normal');
    assert.equal(eastStreams.length, 1);
    assert.equal(trcStreams.length, 1);
    assert.equal(eastStreams[0]!.areaCode, '1310800');
    assert.equal(trcStreams[0]!.areaCode, '1311100');
  } finally {
    db.cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// §7-5. 未判定検出の会場別: east だけ判定済みの受信は east の pending に出ず、trc の pending に残る。
// -------------------------------------------------------------------------------------------------
test('§7-5 未判定検出の会場別: 片方の会場の判定完了が他方の pending を消さない', () => {
  const db = setupDb();
  try {
    const rawXml = buildVpws50Xml([{ areaCode: '1310800', areaName: '江東区' }]);
    const reception = saveReception(db.connection, rawXml, 'https://example.test/pending.xml');

    // east だけ処理する
    processWarningTelegramReception(db.connection, reception, '2026-09-09T00:01:00Z', EAST_VENUE);

    const eastPending = listPendingWarningTelegramReceptions(db.connection, 'east');
    const trcPending = listPendingWarningTelegramReceptions(db.connection, 'trc');
    assert.equal(eastPending.receptions.length, 0);
    assert.equal(trcPending.receptions.length, 1);
    assert.equal(trcPending.receptions[0]!.id, reception.id);
  } finally {
    db.cleanup();
  }
});

test('§7-5b 未対応形式（adoption_decided_at=null）の行は、記録済みでもその会場で依然 pending のまま', () => {
  const db = setupDb();
  try {
    const input: TelegramReceptionInput = {
      fetchAttemptId: null,
      feedKind: 'extra',
      feedEntryId: 'entry-invalid',
      documentUrl: 'https://example.test/invalid-envelope.xml',
      telegramType: 'VPWW55',
      title: null,
      controlStatus: null,
      infoType: null,
      eventId: null,
      serial: null,
      controlDateTime: null,
      reportDateTime: null,
      targetDateTime: null,
      receivedAt: '2026-09-09T00:00:01.000Z',
      rawBody: '<Unknown/>',
      bodyBytes: 10,
      contentHash: 'hash-invalid',
      areas: [],
      adoptions: VENUE_IDS.map((venueId) => ({
        venueId,
        adoptionResult: '未対応形式',
        adoptionReason: 'ルートタグが未知のフォーマット',
        adoptionDecidedAt: null,
      })),
    };
    const reception = recordTelegramReception(db.connection, input);

    const eastPending = listPendingWarningTelegramReceptions(db.connection, 'east');
    const trcPending = listPendingWarningTelegramReceptions(db.connection, 'trc');
    assert.equal(eastPending.receptions.length, 1);
    assert.equal(eastPending.receptions[0]!.id, reception.id);
    assert.equal(trcPending.receptions.length, 1);
    assert.equal(trcPending.receptions[0]!.id, reception.id);
  } finally {
    db.cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// §7-6. 起動時の冪等性: VENUE_IDS ループの再処理＋再構築を2回実行しても件数・内容が変化しない。
// -------------------------------------------------------------------------------------------------
test('§7-6 起動時の冪等性: 再処理＋再構築を2回実行しても件数・現況が変化しない', async () => {
  const db = setupDb();
  try {
    const rawXml = buildVpws50Xml([
      { areaCode: '1310800', areaName: '江東区' },
      { areaCode: '1311100', areaName: '大田区' },
    ]);
    saveReception(db.connection, rawXml, 'https://example.test/idempotent.xml');

    {
      for (const venueId of VENUE_IDS) {
        const venue = resolveVenueWarningContext(venueId);
        await reprocessPendingWarningTelegramReceptions(
          db.connection,
          venue,
          () => '2026-09-09T00:01:00.000Z',
        );
        rebuildWarningCurrentFromReceptions(db.connection, venue.targetArea);
      }

      const receptionCount1 = listTelegramReceptions(db.connection).length;
      const areaCount1 = (
        db.connection.prepare('SELECT COUNT(*) as c FROM telegram_reception_area').get() as {
          c: number;
        }
      ).c;
      const adoptionCount1 = (
        db.connection.prepare('SELECT COUNT(*) as c FROM telegram_reception_adoption').get() as {
          c: number;
        }
      ).c;
      const notificationCount1 = listNotificationOutputHistory(db.connection).length;
      const eastSnapshot1 = findWarningCurrentSnapshot(db.connection, '1310800', 'normal');
      const trcSnapshot1 = findWarningCurrentSnapshot(db.connection, '1311100', 'normal');

      for (const venueId of VENUE_IDS) {
        const venue = resolveVenueWarningContext(venueId);
        await reprocessPendingWarningTelegramReceptions(
          db.connection,
          venue,
          () => '2026-09-09T00:02:00.000Z',
        );
        rebuildWarningCurrentFromReceptions(db.connection, venue.targetArea);
      }

      const receptionCount2 = listTelegramReceptions(db.connection).length;
      const areaCount2 = (
        db.connection.prepare('SELECT COUNT(*) as c FROM telegram_reception_area').get() as {
          c: number;
        }
      ).c;
      const adoptionCount2 = (
        db.connection.prepare('SELECT COUNT(*) as c FROM telegram_reception_adoption').get() as {
          c: number;
        }
      ).c;
      const notificationCount2 = listNotificationOutputHistory(db.connection).length;
      const eastSnapshot2 = findWarningCurrentSnapshot(db.connection, '1310800', 'normal');
      const trcSnapshot2 = findWarningCurrentSnapshot(db.connection, '1311100', 'normal');

      assert.equal(receptionCount2, receptionCount1);
      assert.equal(areaCount2, areaCount1);
      // 受信1件 × 会場数 = 2 行から増えない
      assert.equal(adoptionCount1, 2);
      assert.equal(adoptionCount2, adoptionCount1);
      assert.equal(notificationCount2, notificationCount1);
      assert.deepEqual(eastSnapshot2, eastSnapshot1);
      assert.deepEqual(trcSnapshot2, trcSnapshot1);
    }
  } finally {
    db.cleanup();
  }
});

// -------------------------------------------------------------------------------------------------
// §7-7. 移行後の東地区一致: east 単独処理と、両会場処理後の east 側データが完全一致する。
// -------------------------------------------------------------------------------------------------
test('§7-7 移行後の東地区一致: east 単独処理と両会場処理後の east 側現況・採用行が完全一致する', () => {
  const rawXml = buildVpws50Xml([
    { areaCode: '1310800', areaName: '江東区' },
    { areaCode: '1311100', areaName: '大田区' },
  ]);

  const dbEastOnly = setupDb();
  let eastOnlySnapshot;
  let eastOnlyAdoption;
  try {
    const reception = saveReception(
      dbEastOnly.connection,
      rawXml,
      'https://example.test/east-only.xml',
    );
    processWarningTelegramReception(
      dbEastOnly.connection,
      reception,
      '2026-09-09T00:01:00Z',
      EAST_VENUE,
    );
    eastOnlySnapshot = findWarningCurrentSnapshot(dbEastOnly.connection, '1310800', 'normal');
    eastOnlyAdoption = findTelegramReceptionById(
      dbEastOnly.connection,
      reception.id,
    )?.adoptions.find((a) => a.venueId === 'east');
  } finally {
    dbEastOnly.cleanup();
  }

  const dbBoth = setupDb();
  let bothEastSnapshot;
  let bothEastAdoption;
  try {
    const reception = saveReception(
      dbBoth.connection,
      rawXml,
      'https://example.test/east-only.xml',
    );
    processWarningTelegramReception(
      dbBoth.connection,
      reception,
      '2026-09-09T00:01:00Z',
      EAST_VENUE,
    );
    processWarningTelegramReception(
      dbBoth.connection,
      reception,
      '2026-09-09T00:02:00Z',
      TRC_VENUE,
    );
    bothEastSnapshot = findWarningCurrentSnapshot(dbBoth.connection, '1310800', 'normal');
    bothEastAdoption = findTelegramReceptionById(dbBoth.connection, reception.id)?.adoptions.find(
      (a) => a.venueId === 'east',
    );
  } finally {
    dbBoth.cleanup();
  }

  assert.deepEqual(bothEastSnapshot, eastOnlySnapshot);
  assert.deepEqual(bothEastAdoption, eastOnlyAdoption);
});

// -------------------------------------------------------------------------------------------------
// §7-9 (API側): telegram_reception_adoption の列名・venueWeatherService の引数・migration SQL に
// TerminalMode ('H'/'K') の文字列が現れない（文字列検査）。
// -------------------------------------------------------------------------------------------------
test('§7-9 端末モードの非混入: migration・venueWeatherService のソースに H/K のモード文字列が現れない', () => {
  const migrationSql = readFileSync(
    join(apiRoot, 'migrations', '0018_create_telegram_reception_adoption.sql'),
    'utf-8',
  );
  const venueWeatherServiceSource = readFileSync(
    join(apiRoot, 'src', 'services', 'venueWeatherService.ts'),
    'utf-8',
  );
  const repositoryTypesSource = readFileSync(
    join(apiRoot, 'src', 'repositories', 'types.ts'),
    'utf-8',
  );

  for (const [label, source] of [
    ['migration 0018', migrationSql],
    ['venueWeatherService.ts', venueWeatherServiceSource],
  ] as const) {
    assert.doesNotMatch(source, /'H'|'K'|"H"|"K"/, `${label} に端末モード文字列が含まれています`);
  }

  // TelegramReceptionAdoption 周辺の型定義にも端末モードが現れないこと
  const adoptionTypeSection = repositoryTypesSource.slice(
    repositoryTypesSource.indexOf('interface TelegramReceptionAdoption'),
    repositoryTypesSource.indexOf('interface TelegramReceptionAdoptionInput') +
      'interface TelegramReceptionAdoptionInput'.length +
      500,
  );
  assert.doesNotMatch(adoptionTypeSection, /'H'|'K'|"H"|"K"/);
});

// -------------------------------------------------------------------------------------------------
// §3.3.1: C5/C6 は「全会場で同一に解決される」という前提が崩れたら静かに壊れるため、
// resolveSharedEarlyWarningTargetArea / resolveSharedAreaTimeseriesForecastTarget を
// 実際のポーリング経路（jmaXmlPoller.ts）で呼び出すことを保証する。
// この表明をテストだけが呼び、本番経路が素の DEFAULT_* 定数を直に使う退行を防ぐ。
// -------------------------------------------------------------------------------------------------
test('§3.3.1 共有対象の表明が実際のポーリング経路から呼ばれている', () => {
  const pollerSource = readFileSync(join(apiRoot, 'src', 'polling', 'jmaXmlPoller.ts'), 'utf-8');

  assert.match(
    pollerSource,
    /resolveSharedEarlyWarningTargetArea\(\)/,
    'jmaXmlPoller.ts は C5 の対象解決に resolveSharedEarlyWarningTargetArea() を使う必要があります',
  );
  assert.match(
    pollerSource,
    /resolveSharedAreaTimeseriesForecastTarget\(\)/,
    'jmaXmlPoller.ts は C6 の対象解決に resolveSharedAreaTimeseriesForecastTarget() を使う必要があります',
  );
  assert.doesNotMatch(
    pollerSource,
    /DEFAULT_EARLY_WARNING_TARGET_AREA|DEFAULT_AREA_TIMESERIES_FORECAST_TARGET/,
    'jmaXmlPoller.ts が会場非依存の DEFAULT_* 定数を直接使うと、会場間の対象不一致を検知する ' +
      'resolveShared* の表明を素通りしてしまいます',
  );
});
