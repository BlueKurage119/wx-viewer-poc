import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeDatabase } from '../src/database/index.js';
import { recordFetchAttempt } from '../src/repositories/fetchAttemptRepository.js';
import {
  findTelegramReceptionById,
  recordTelegramReception,
} from '../src/repositories/telegramReceptionRepository.js';
import { findWarningTimeseriesSnapshot } from '../src/repositories/warningTimeseriesRepository.js';
import { processVpwp50Reception } from '../src/polling/jmaVpwp50Processor.js';
import type { TelegramReceptionInput } from '../src/repositories/types.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');

function setupTestDb() {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-vpwp50-processor-test-'));
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

function createSampleReception(
  context: ReturnType<typeof setupTestDb>['context'],
  options: {
    rawXml?: string;
    controlStatus?: 'normal' | 'training' | 'test';
    telegramType?: string;
    reportDateTime?: string;
    controlDateTime?: string;
    documentUrl?: string;
  } = {},
) {
  const attempt = recordFetchAttempt(context.connection, {
    sourceKind: 'xml_document',
    targetRef: 'regular',
    requestUrl: options.documentUrl ?? 'https://example.com/vpwp50_test.xml',
    triggerKind: 'scheduled',
    attemptNo: 1,
    startedAt: '2026-09-09T00:00:00.000Z',
    finishedAt: '2026-09-09T00:00:01.000Z',
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

  const input: TelegramReceptionInput = {
    fetchAttemptId: attempt.id,
    feedKind: 'regular',
    feedEntryId: 'entry-1',
    documentUrl: options.documentUrl ?? 'https://example.com/vpwp50_test.xml',
    telegramType: options.telegramType ?? 'VPWP50',
    title: '気象警報・注意報時系列情報',
    controlStatus: options.controlStatus ?? 'normal',
    infoType: '発表',
    eventId: null,
    serial: null,
    controlDateTime: options.controlDateTime ?? '2026-09-09T00:00:00.000Z',
    reportDateTime: options.reportDateTime ?? '2026-09-09T00:00:00.000Z',
    targetDateTime: null,
    receivedAt: '2026-09-09T00:00:01.000Z',
    adoptionResult: null,
    adoptionReason: null,
    adoptionDecidedAt: null,
    rawBody: options.rawXml !== undefined ? options.rawXml : buildSampleVpwp50Xml(options),
    bodyBytes: 1024,
    contentHash: 'hash-1234',
    areas: [{ sequence: 1, areaCode: '1310800', areaName: '江東区' }],
  };

  return recordTelegramReception(context.connection, input);
}

function buildSampleVpwp50Xml(
  options: {
    controlStatus?: 'normal' | 'training' | 'test';
    areaCode?: string;
    isInvalidStructure?: boolean;
  } = {},
): string {
  const statusStr =
    options.controlStatus === 'training'
      ? '訓練'
      : options.controlStatus === 'test'
        ? '試験'
        : '通常';
  const areaCode = options.areaCode ?? '1310800';

  if (options.isInvalidStructure) {
    return `<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
      <Control><Status>${statusStr}</Status><DateTime>2026-09-09T00:00:00Z</DateTime></Control>
      <Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/"><ReportDateTime>2026-09-09T09:00:00+09:00</ReportDateTime><InfoType>発表</InfoType><InfoKind>気象警報・注意報時系列</InfoKind></Head>
      <Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/">
        <MeteorologicalInfos type="量的予想時系列（市町村等）">
          <TimeSeriesInfo>
            <TimeDefines><TimeDefine timeId="1"><DateTime>2026-09-09T09:00:00+09:00</DateTime><Duration>INVALID</Duration></TimeDefine></TimeDefines>
            <Item><Kind><Status>発表</Status><Property><Type>雨</Type></Property></Kind><Area><Name>江東区</Name><Code>1310800</Code></Area></Item>
          </TimeSeriesInfo>
        </MeteorologicalInfos>
      </Body>
    </Report>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
<Control>
<Title>気象警報・注意報時系列情報（Ｒ０６）</Title>
<DateTime>2026-09-09T00:00:00Z</DateTime>
<Status>${statusStr}</Status>
<EditorialOffice>気象庁本庁</EditorialOffice>
<PublishingOffice>気象庁</PublishingOffice>
</Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
<Title>東京都警戒・注意事項時系列情報</Title>
<ReportDateTime>2026-09-09T09:00:00+09:00</ReportDateTime>
<TargetDateTime>2026-09-09T09:00:00+09:00</TargetDateTime>
<EventID/>
<InfoType>発表</InfoType>
<Serial/>
<InfoKind>気象警報・注意報時系列</InfoKind>
<InfoKindVersion>1.5_0</InfoKindVersion>
<Headline><Text/></Headline>
</Head>
<Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/" xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/">
<MeteorologicalInfos type="量的予想時系列（市町村等）">
<TimeSeriesInfo>
<TimeDefines>
<TimeDefine timeId="1"><DateTime>2026-09-09T09:00:00+09:00</DateTime><Duration>PT3H</Duration><Name>９日昼前</Name></TimeDefine>
<TimeDefine timeId="2"><DateTime>2026-09-09T12:00:00+09:00</DateTime><Duration>PT3H</Duration><Name>９日昼過ぎ</Name></TimeDefine>
</TimeDefines>
<Item>
<Kind>
<Status>発表</Status>
<DateTime type="発表時刻">2026-09-09T09:00:00+09:00</DateTime>
<Property>
<Type>大雨浸水危険度</Type>
<SignificancyPart>
<Base>
<Significancy refID="1" type="大雨浸水危険度"><Name>警戒レベル２未満</Name><Code>11</Code></Significancy>
<Significancy refID="2" type="大雨浸水危険度"><Name>警戒レベル３相当</Name><Code>30</Code></Significancy>
</Base>
</SignificancyPart>
</Property>
</Kind>
<Kind>
<Status>発表</Status>
<DateTime type="発表時刻">2026-09-09T09:00:00+09:00</DateTime>
<Property>
<Type>雨</Type>
<PrecipitationPart>
<Base>
<jmx_eb:Precipitation description="１０ミリ" refID="1" type="１時間最大雨量" unit="mm">10</jmx_eb:Precipitation>
<jmx_eb:Precipitation description="３０ミリ" refID="2" type="１時間最大雨量" unit="mm">30</jmx_eb:Precipitation>
</Base>
</PrecipitationPart>
</Property>
</Kind>
<Area><Name>江東区</Name><Code>${areaCode}</Code></Area>
</Item>
</TimeSeriesInfo>
</MeteorologicalInfos>
</Body>
</Report>`;
}

test('processVpwp50Reception: 正常系 - スナップショット保存と採用結果記録（原子的）', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const reception = createSampleReception(context);
    const processedAt = '2026-09-09T00:00:02.000Z';

    const result = processVpwp50Reception(context.connection, reception, processedAt);
    assert.equal(result.ok, true);

    // reception の adoption 結果が更新されていること
    const updatedReception = findTelegramReceptionById(context.connection, reception.id);
    assert.ok(updatedReception);
    assert.equal(updatedReception.adoptionResult, '警報等時系列として解析済み');
    assert.equal(updatedReception.adoptionReason, null);
    assert.equal(updatedReception.adoptionDecidedAt, processedAt);

    // warning_timeseries_snapshot が保存されていること
    const snapshot = findWarningTimeseriesSnapshot(context.connection, '1310800', 'normal');
    assert.ok(snapshot);
    assert.equal(snapshot.areaCode, '1310800');
    assert.equal(snapshot.areaName, '江東区');
    assert.equal(snapshot.metadata.availability, 'available');
    assert.equal(snapshot.metadata.source, reception.documentUrl);
    assert.equal(snapshot.metadata.issuedAt, '2026-09-09T00:00:00.000Z');
    assert.equal(snapshot.metadata.lastSuccessAt, processedAt);
    assert.equal(snapshot.timeDefines.length, 2);
    assert.equal(snapshot.values.length, 4);

    // 値の詳細確認
    assert.equal(snapshot.values[0].valueCategory, 'risk');
    assert.equal(snapshot.values[0].valueCode, '11');
    assert.equal(snapshot.values[0].valueText, '警戒レベル２未満');
    assert.equal(snapshot.values[2].valueCategory, 'quantity');
    assert.equal(snapshot.values[2].valueText, '10');
    assert.equal(snapshot.values[2].unit, 'mm');
  } finally {
    cleanup();
  }
});

test('processVpwp50Reception: 予測の独立性 - 現況警報・ストリーム・通知履歴が一切更新されない', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const reception = createSampleReception(context);
    const processedAt = '2026-09-09T00:00:02.000Z';

    // 処理実行
    const result = processVpwp50Reception(context.connection, reception, processedAt);
    assert.equal(result.ok, true);

    // 現況警報テーブルの行数が 0 件であることを確認
    const currentSnapshots = context.connection
      .prepare('SELECT COUNT(*) as count FROM warning_current_snapshot')
      .get() as { count: number };
    assert.equal(currentSnapshots.count, 0, 'warning_current_snapshot は 0 件');

    const currentItems = context.connection
      .prepare('SELECT COUNT(*) as count FROM warning_current_item')
      .get() as { count: number };
    assert.equal(currentItems.count, 0, 'warning_current_item は 0 件');

    const currentStreams = context.connection
      .prepare('SELECT COUNT(*) as count FROM warning_current_stream')
      .get() as { count: number };
    assert.equal(currentStreams.count, 0, 'warning_current_stream は 0 件');

    const notifications = context.connection
      .prepare('SELECT COUNT(*) as count FROM notification_output_history')
      .get() as { count: number };
    assert.equal(notifications.count, 0, 'notification_output_history は 0 件');
  } finally {
    cleanup();
  }
});

test('processVpwp50Reception: 訓練データの分離 - controlStatus=training は normal に影響しない', () => {
  const { context, cleanup } = setupTestDb();
  try {
    // 1. 通常データを保存
    const normalReception = createSampleReception(context, {
      controlStatus: 'normal',
      documentUrl: 'https://example.com/normal.xml',
    });
    processVpwp50Reception(context.connection, normalReception, '2026-09-09T00:00:02.000Z');

    const normalBefore = findWarningTimeseriesSnapshot(context.connection, '1310800', 'normal');
    assert.ok(normalBefore);
    assert.equal(normalBefore.metadata.source, 'https://example.com/normal.xml');

    // 2. 訓練データを保存
    const trainingReception = createSampleReception(context, {
      controlStatus: 'training',
      documentUrl: 'https://example.com/training.xml',
    });
    const trainingResult = processVpwp50Reception(
      context.connection,
      trainingReception,
      '2026-09-09T00:00:03.000Z',
    );
    assert.equal(trainingResult.ok, true);

    // 訓練スナップショットが保存されていること
    const trainingSnapshot = findWarningTimeseriesSnapshot(
      context.connection,
      '1310800',
      'training',
    );
    assert.ok(trainingSnapshot);
    assert.equal(trainingSnapshot.metadata.source, 'https://example.com/training.xml');

    // 通常スナップショットが一切変更されていないこと
    const normalAfter = findWarningTimeseriesSnapshot(context.connection, '1310800', 'normal');
    assert.ok(normalAfter);
    assert.equal(normalAfter.metadata.source, 'https://example.com/normal.xml');
    assert.equal(normalAfter.metadata.lastSuccessAt, normalBefore.metadata.lastSuccessAt);
  } finally {
    cleanup();
  }
});

test('processVpwp50Reception: 異常系 - 未対応構造時はスナップショットを変更せず reception に記録', () => {
  const { context, cleanup } = setupTestDb();
  try {
    // 既存の正常スナップショットを保存
    const validReception = createSampleReception(context, {
      documentUrl: 'https://example.com/valid.xml',
    });
    processVpwp50Reception(context.connection, validReception, '2026-09-09T00:00:02.000Z');
    const beforeSnapshot = findWarningTimeseriesSnapshot(context.connection, '1310800', 'normal');
    assert.ok(beforeSnapshot);

    // 不正な構造の電文を処理
    const invalidReception = createSampleReception(context, {
      documentUrl: 'https://example.com/invalid.xml',
      rawXml: buildSampleVpwp50Xml({ isInvalidStructure: true }),
    });

    const result = processVpwp50Reception(
      context.connection,
      invalidReception,
      '2026-09-09T00:00:03.000Z',
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.disposition, '未対応構造');

    // reception に記録されていること
    const updated = findTelegramReceptionById(context.connection, invalidReception.id);
    assert.ok(updated);
    assert.equal(updated.adoptionResult, '未対応構造');
    assert.ok(updated.adoptionReason);
    assert.equal(updated.adoptionDecidedAt, '2026-09-09T00:00:03.000Z');

    // 既存スナップショットが一切変更されていないこと
    const afterSnapshot = findWarningTimeseriesSnapshot(context.connection, '1310800', 'normal');
    assert.ok(afterSnapshot);
    assert.equal(afterSnapshot.metadata.source, 'https://example.com/valid.xml');
    assert.equal(afterSnapshot.timeDefines.length, beforeSnapshot.timeDefines.length);
  } finally {
    cleanup();
  }
});

test('processVpwp50Reception: 対象地域外 - スナップショットを変更せず reception に対象地域外を記録', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const reception = createSampleReception(context, {
      documentUrl: 'https://example.com/other_area.xml',
      rawXml: buildSampleVpwp50Xml({ areaCode: '0121400' }), // 稚内市
    });

    const result = processVpwp50Reception(
      context.connection,
      reception,
      '2026-09-09T00:00:02.000Z',
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.disposition, '対象地域外');

    const updated = findTelegramReceptionById(context.connection, reception.id);
    assert.ok(updated);
    assert.equal(updated.adoptionResult, '対象地域外');
    assert.equal(updated.adoptionDecidedAt, '2026-09-09T00:00:02.000Z');

    // スナップショットは作成されないこと
    const snapshot = findWarningTimeseriesSnapshot(context.connection, '1310800', 'normal');
    assert.equal(snapshot, null);
  } finally {
    cleanup();
  }
});

test('processVpwp50Reception: rawBody が null の場合は未対応構造', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const attempt = recordFetchAttempt(context.connection, {
      sourceKind: 'xml_document',
      targetRef: 'regular',
      requestUrl: 'https://example.com/null_body.xml',
      triggerKind: 'scheduled',
      attemptNo: 1,
      startedAt: '2026-09-09T00:00:00.000Z',
      finishedAt: '2026-09-09T00:00:01.000Z',
      durationMs: 1000,
      outcome: 'success',
      httpStatus: 200,
      responseBytes: 0,
      itemCount: null,
      failedItemCount: null,
      contentHash: 'hash-null',
      errorKind: null,
      errorMessage: null,
    });

    const reception = recordTelegramReception(context.connection, {
      fetchAttemptId: attempt.id,
      feedKind: 'regular',
      feedEntryId: 'entry-null',
      documentUrl: 'https://example.com/null_body.xml',
      telegramType: 'VPWP50',
      title: '気象警報・注意報時系列情報',
      controlStatus: 'normal',
      infoType: '発表',
      eventId: null,
      serial: null,
      controlDateTime: '2026-09-09T00:00:00.000Z',
      reportDateTime: '2026-09-09T00:00:00.000Z',
      targetDateTime: null,
      receivedAt: '2026-09-09T00:00:01.000Z',
      adoptionResult: null,
      adoptionReason: null,
      adoptionDecidedAt: null,
      rawBody: null,
      bodyBytes: null,
      contentHash: 'hash-null',
      areas: [{ sequence: 1, areaCode: '1310800', areaName: '江東区' }],
    });

    const result = processVpwp50Reception(
      context.connection,
      reception,
      '2026-09-09T00:00:02.000Z',
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.disposition, '未対応構造');
    assert.equal(result.reason, '原文（raw_body）がありません');

    const updated = findTelegramReceptionById(context.connection, reception.id);
    assert.ok(updated);
    assert.equal(updated.adoptionResult, '未対応構造');
    assert.equal(updated.adoptionReason, '原文（raw_body）がありません');
  } finally {
    cleanup();
  }
});
