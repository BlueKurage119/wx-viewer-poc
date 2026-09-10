import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeDatabase } from '../src/database/index.js';
import { recordFetchAttempt } from '../src/repositories/fetchAttemptRepository.js';
import {
  findTelegramReceptionById,
  recordTelegramReception,
} from '../src/repositories/telegramReceptionRepository.js';
import { findAreaTimeseriesSnapshot } from '../src/repositories/areaTimeseriesRepository.js';
import { processVpfd51Reception } from '../src/polling/jmaVpfd51Processor.js';
import type { TelegramReceptionInput } from '../src/repositories/types.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');
const jmaFixturesDir = join(apiRoot, 'tests/fixtures/jma');

function setupTestDb() {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-vpfd51-processor-test-'));
  const databasePath = join(directory, 'test.sqlite3');
  const context = initializeDatabase({ databasePath, migrationsDirectory });
  return {
    context,
    cleanup: () => {
      context.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function buildSampleVpfd51Xml(
  options: {
    controlStatus?: 'normal' | 'training' | 'test';
    areaCode?: string;
    stationCode?: string;
    isInvalidStructure?: boolean;
  } = {},
): string {
  if (options.isInvalidStructure) {
    return '<invalid <xml';
  }

  const statusStr =
    options.controlStatus === 'training'
      ? '訓練'
      : options.controlStatus === 'test'
        ? '試験'
        : '通常';

  const areaCode = options.areaCode ?? '130010';
  const stationCode = options.stationCode ?? '44132';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/" xmlns:jmx="http://xml.kishou.go.jp/jmaxml1/">
  <Control>
    <Title>府県天気予報（Ｒ１）</Title>
    <DateTime>2026-09-10T07:48:12Z</DateTime>
    <Status>${statusStr}</Status>
    <EditorialOffice>気象庁本庁</EditorialOffice>
    <PublishingOffice>気象庁予報部</PublishingOffice>
  </Control>
  <Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
    <Title>東京都府県天気予報</Title>
    <ReportDateTime>2026-09-10T17:00:00+09:00</ReportDateTime>
    <TargetDateTime>2026-09-10T17:00:00+09:00</TargetDateTime>
    <TargetDuration>P2DT7H</TargetDuration>
    <EventID/>
    <InfoType>発表</InfoType>
    <Serial/>
    <InfoKind>府県天気予報</InfoKind>
    <InfoKindVersion>1.0_1</InfoKindVersion>
    <Headline><Text/></Headline>
  </Head>
  <Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/" xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/">
    <MeteorologicalInfos type="区域予報">
      <TimeSeriesInfo>
        <TimeDefines>
          <TimeDefine timeId="1">
            <DateTime>2026-09-10T18:00:00+09:00</DateTime>
            <Duration>PT3H</Duration>
          </TimeDefine>
        </TimeDefines>
        <Item>
          <Kind>
            <Property>
              <Type>３時間内卓越天気</Type>
              <WeatherPart>
                <jmx_eb:Weather refID="1" type="天気">くもり</jmx_eb:Weather>
              </WeatherPart>
            </Property>
          </Kind>
          <Kind>
            <Property>
              <Type>３時間内代表風</Type>
              <WindDirectionPart>
                <jmx_eb:WindDirection refID="1" type="風向" unit="８方位漢字">北</jmx_eb:WindDirection>
              </WindDirectionPart>
              <WindSpeedPart>
                <WindSpeedLevel refID="1" type="風速階級">3</WindSpeedLevel>
              </WindSpeedPart>
            </Property>
          </Kind>
          <Area>
            <Name>東京地方</Name>
            <Code>${areaCode}</Code>
          </Area>
        </Item>
      </TimeSeriesInfo>
    </MeteorologicalInfos>
    <MeteorologicalInfos type="地点予報">
      <TimeSeriesInfo>
        <TimeDefines>
          <TimeDefine timeId="1">
            <DateTime>2026-09-10T18:00:00+09:00</DateTime>
          </TimeDefine>
        </TimeDefines>
        <Item>
          <Kind>
            <Property>
              <Type>３時間毎気温</Type>
              <TemperaturePart>
                <jmx_eb:Temperature refID="1" type="気温" unit="度">22</jmx_eb:Temperature>
              </TemperaturePart>
            </Property>
          </Kind>
          <Station>
            <Name>東京</Name>
            <Code>${stationCode}</Code>
          </Station>
        </Item>
      </TimeSeriesInfo>
    </MeteorologicalInfos>
  </Body>
</Report>`;
}

function createReceptionRecord(
  db: ReturnType<typeof setupTestDb>['context'],
  overrides: Partial<TelegramReceptionInput> = {},
) {
  const attempt = recordFetchAttempt(db.connection, {
    sourceKind: 'xml_document',
    targetRef: 'regular',
    requestUrl: overrides.documentUrl ?? 'https://example.com/vpfd51.xml',
    triggerKind: 'scheduled',
    attemptNo: 1,
    startedAt: '2026-09-10T08:00:00.000Z',
    finishedAt: '2026-09-10T08:00:01.000Z',
    durationMs: 1000,
    outcome: 'success',
    httpStatus: 200,
    responseBytes: 1024,
    itemCount: null,
    failedItemCount: null,
    contentHash: 'hash-1234',
    errorKind: null,
    errorMessage: null,
  });

  const rawBody = overrides.rawBody !== undefined ? overrides.rawBody : buildSampleVpfd51Xml();

  const input: TelegramReceptionInput = {
    fetchAttemptId: attempt.id,
    feedKind: 'regular',
    feedEntryId: 'entry-1',
    documentUrl: overrides.documentUrl ?? 'https://example.com/vpfd51.xml',
    telegramType: 'VPFD51',
    title: '東京都府県天気予報',
    controlStatus: overrides.controlStatus ?? 'normal',
    infoType: '発表',
    eventId: null,
    serial: null,
    controlDateTime: overrides.controlDateTime ?? '2026-09-10T07:48:12.000Z',
    reportDateTime: overrides.reportDateTime ?? '2026-09-10T08:00:00.000Z',
    targetDateTime: null,
    receivedAt: '2026-09-10T08:00:01.000Z',
    adoptionResult: null,
    adoptionReason: null,
    adoptionDecidedAt: null,
    rawBody,
    bodyBytes: rawBody ? Buffer.byteLength(rawBody, 'utf-8') : 0,
    contentHash: 'hash-xml',
    areas: [{ sequence: 1, areaCode: '130010', areaName: '東京地方' }],
    ...overrides,
  };

  return recordTelegramReception(db.connection, input);
}

test('processVpfd51Reception: 正常パース時に snapshot 保存と adoption 更新が同一 tx で行われる', () => {
  const db = setupTestDb();
  try {
    const reception = createReceptionRecord(db.context);
    const processedAt = '2026-09-10T08:00:05.000Z';

    const result = processVpfd51Reception(db.context.connection, reception, processedAt);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // snapshot の確認
    const snapshot = findAreaTimeseriesSnapshot(db.context.connection, '130010', '44132', 'normal');
    assert.ok(snapshot);
    assert.equal(snapshot.areaCode, '130010');
    assert.equal(snapshot.areaName, '東京地方');
    assert.equal(snapshot.stationCode, '44132');
    assert.equal(snapshot.stationName, '東京');
    assert.equal(snapshot.metadata.source, reception.documentUrl);
    assert.equal(snapshot.metadata.issuedAt, '2026-09-10T08:00:00.000Z');
    assert.equal(snapshot.metadata.validAt, null);
    assert.equal(snapshot.metadata.validFrom, null);
    assert.equal(snapshot.metadata.validTo, null);
    assert.equal(snapshot.metadata.availability, 'available');
    assert.equal(snapshot.metadata.lastSuccessAt, processedAt);
    assert.equal(snapshot.metadata.sourceVersion, '1.0_1');
    assert.equal(snapshot.timeDefines.length, 2); // 区域1 + 地点1
    assert.equal(snapshot.values.length, 4); // 天気1 + 風向1 + 風速1 + 気温1

    // adoption の確認
    const updatedReception = findTelegramReceptionById(db.context.connection, reception.id);
    assert.ok(updatedReception);
    assert.equal(updatedReception.adoptionResult, '地域時系列予報として解析済み');
    assert.equal(updatedReception.adoptionReason, null);
    assert.equal(updatedReception.adoptionDecidedAt, processedAt);
  } finally {
    db.cleanup();
  }
});

test('processVpfd51Reception: 公式サンプルファイルでの統合テスト', () => {
  const samplePath = join(jmaFixturesDir, '24_11_03_190925_VPFD51.xml');
  assert.ok(existsSync(samplePath), `fixture not found: ${samplePath}`);

  const db = setupTestDb();
  try {
    const rawXml = readFileSync(samplePath, 'utf-8');
    const reception = createReceptionRecord(db.context, {
      reportDateTime: '2016-11-23T08:00:00.000Z',
      controlDateTime: '2016-11-23T07:48:12.000Z',
      rawBody: rawXml,
    });
    const processedAt = '2026-09-10T08:00:05.000Z';

    const result = processVpfd51Reception(db.context.connection, reception, processedAt);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const snapshot = findAreaTimeseriesSnapshot(db.context.connection, '130010', '44132', 'normal');
    assert.ok(snapshot);
    assert.equal(snapshot.timeDefines.length, 21);
    assert.equal(snapshot.values.length, 41);

    const regionTds = snapshot.timeDefines.filter((td) => td.blockId === 'region-3hour');
    const pointTds = snapshot.timeDefines.filter((td) => td.blockId === 'temperature-3hour');
    assert.equal(regionTds.length, 10);
    assert.equal(pointTds.length, 11);

    const updatedReception = findTelegramReceptionById(db.context.connection, reception.id);
    assert.equal(updatedReception?.adoptionResult, '地域時系列予報として解析済み');
  } finally {
    db.cleanup();
  }
});

test('processVpfd51Reception: rawBody が null の場合は「未対応構造」を記録し snapshot は作成しない', () => {
  const db = setupTestDb();
  try {
    const reception = createReceptionRecord(db.context, { rawBody: null });
    const processedAt = '2026-09-10T08:00:05.000Z';

    const result = processVpfd51Reception(db.context.connection, reception, processedAt);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.disposition, '未対応構造');

    const snapshot = findAreaTimeseriesSnapshot(db.context.connection, '130010', '44132', 'normal');
    assert.equal(snapshot, null);

    const updatedReception = findTelegramReceptionById(db.context.connection, reception.id);
    assert.equal(updatedReception?.adoptionResult, '未対応構造');
    assert.equal(updatedReception?.adoptionReason, '原文（raw_body）がありません');
  } finally {
    db.cleanup();
  }
});

test('processVpfd51Reception: 対象地域外の場合は既存 snapshot を変更せず、adoption に「対象地域外」を記録する', () => {
  const db = setupTestDb();
  try {
    // 既存の正常 snapshot を先に作成
    const reception1 = createReceptionRecord(db.context);
    processVpfd51Reception(db.context.connection, reception1, '2026-09-10T08:00:05.000Z');

    const initialSnapshot = findAreaTimeseriesSnapshot(
      db.context.connection,
      '130010',
      '44132',
      'normal',
    );
    assert.ok(initialSnapshot);

    // 他地域の電文
    const otherAreaXml = buildSampleVpfd51Xml({ areaCode: '999999' });
    const reception2 = createReceptionRecord(db.context, {
      documentUrl: 'https://example.com/other.xml',
      rawBody: otherAreaXml,
    });

    const result = processVpfd51Reception(
      db.context.connection,
      reception2,
      '2026-09-10T08:05:00.000Z',
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.disposition, '対象地域外');

    // 既存 snapshot は無変更
    const afterSnapshot = findAreaTimeseriesSnapshot(
      db.context.connection,
      '130010',
      '44132',
      'normal',
    );
    assert.deepEqual(afterSnapshot, initialSnapshot);

    const updatedReception = findTelegramReceptionById(db.context.connection, reception2.id);
    assert.equal(updatedReception?.adoptionResult, '対象地域外');
  } finally {
    db.cleanup();
  }
});

test('processVpfd51Reception: 未対応構造の場合は既存 snapshot を変更せず、adoption に「未対応構造」を記録する', () => {
  const db = setupTestDb();
  try {
    const reception1 = createReceptionRecord(db.context);
    processVpfd51Reception(db.context.connection, reception1, '2026-09-10T08:00:05.000Z');

    const initialSnapshot = findAreaTimeseriesSnapshot(
      db.context.connection,
      '130010',
      '44132',
      'normal',
    );
    assert.ok(initialSnapshot);

    // 構造不正の電文
    const invalidXml = buildSampleVpfd51Xml({ isInvalidStructure: true });
    const reception2 = createReceptionRecord(db.context, {
      documentUrl: 'https://example.com/invalid.xml',
      rawBody: invalidXml,
    });

    const result = processVpfd51Reception(
      db.context.connection,
      reception2,
      '2026-09-10T08:05:00.000Z',
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.disposition, '未対応構造');

    // 既存 snapshot は無変更
    const afterSnapshot = findAreaTimeseriesSnapshot(
      db.context.connection,
      '130010',
      '44132',
      'normal',
    );
    assert.deepEqual(afterSnapshot, initialSnapshot);

    const updatedReception = findTelegramReceptionById(db.context.connection, reception2.id);
    assert.equal(updatedReception?.adoptionResult, '未対応構造');
  } finally {
    db.cleanup();
  }
});

test('processVpfd51Reception: normal と training は別 snapshot として保存され互いに干渉しない', () => {
  const db = setupTestDb();
  try {
    // 1. normal 電文
    const receptionNormal = createReceptionRecord(db.context, {
      controlStatus: 'normal',
      rawBody: buildSampleVpfd51Xml({ controlStatus: 'normal' }),
    });
    processVpfd51Reception(db.context.connection, receptionNormal, '2026-09-10T08:00:05.000Z');

    const normalSnapshot = findAreaTimeseriesSnapshot(
      db.context.connection,
      '130010',
      '44132',
      'normal',
    );
    assert.ok(normalSnapshot);
    assert.equal(normalSnapshot.telegram.controlStatus, 'normal');

    // 2. training 電文
    const receptionTraining = createReceptionRecord(db.context, {
      documentUrl: 'https://example.com/training.xml',
      controlStatus: 'training',
      rawBody: buildSampleVpfd51Xml({ controlStatus: 'training' }),
    });
    processVpfd51Reception(db.context.connection, receptionTraining, '2026-09-10T08:05:05.000Z');

    const trainingSnapshot = findAreaTimeseriesSnapshot(
      db.context.connection,
      '130010',
      '44132',
      'training',
    );
    assert.ok(trainingSnapshot);
    assert.equal(trainingSnapshot.telegram.controlStatus, 'training');

    // normal snapshot が変更されていないこと
    const normalAfter = findAreaTimeseriesSnapshot(
      db.context.connection,
      '130010',
      '44132',
      'normal',
    );
    assert.deepEqual(normalAfter, normalSnapshot);
  } finally {
    db.cleanup();
  }
});

test('processVpfd51Reception: 他種別のテーブルに一切書き込みを行わない', () => {
  const db = setupTestDb();
  try {
    const countTable = (tableName: string) => {
      const row = db.context.connection
        .prepare(`SELECT count(*) as count FROM ${tableName}`)
        .get() as { count: number };
      return row.count;
    };

    const initialWarningCurrent = countTable('warning_current_snapshot');
    const initialWarningTimeseries = countTable('warning_timeseries_snapshot');
    const initialEarlyWarning = countTable('early_warning_snapshot');
    const initialNotification = countTable('notification_output_history');

    const reception = createReceptionRecord(db.context);
    processVpfd51Reception(db.context.connection, reception, '2026-09-10T08:00:05.000Z');

    assert.equal(countTable('warning_current_snapshot'), initialWarningCurrent);
    assert.equal(countTable('warning_timeseries_snapshot'), initialWarningTimeseries);
    assert.equal(countTable('early_warning_snapshot'), initialEarlyWarning);
    assert.equal(countTable('notification_output_history'), initialNotification);
  } finally {
    db.cleanup();
  }
});
