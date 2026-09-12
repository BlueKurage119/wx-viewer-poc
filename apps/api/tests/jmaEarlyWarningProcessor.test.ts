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
import {
  findEarlyWarningSnapshot,
  saveEarlyWarningSnapshot,
} from '../src/repositories/earlyWarningRepository.js';
import { processEarlyWarningReception } from '../src/polling/jmaEarlyWarningProcessor.js';
import { DEFAULT_EARLY_WARNING_TARGET_AREA } from '../src/polling/jmaEarlyWarningParser.js';
import type { TelegramReceptionInput } from '../src/repositories/types.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');

function setupTestDb() {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-ew-processor-test-'));
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

function buildSampleEarlyWarningXml(
  options: {
    telegramType?: 'VPFD61' | 'VPFW60';
    controlStatus?: 'normal' | 'training' | 'test';
    areaCode?: string;
    isInvalidStructure?: boolean;
  } = {},
): string {
  if (options.isInvalidStructure) {
    return '<invalid <xml';
  }

  const telegramType = options.telegramType ?? 'VPFD61';
  const isNear = telegramType === 'VPFD61';
  const statusStr =
    options.controlStatus === 'training'
      ? '訓練'
      : options.controlStatus === 'test'
        ? '試験'
        : '通常';

  const title = isNear ? '早期注意情報（明後日まで）' : '警報級の可能性（明後日以降）';
  const infoKind = isNear ? '警報級の可能性（明日まで）' : '警報級の可能性（明後日以降）';
  const infoKindVersion = isNear ? '1.5_0' : '1.2_0';
  const areaCode = options.areaCode ?? '130010';

  const timeDefinesXml = isNear
    ? `
      <TimeDefine timeId="1">
        <DateTime>2026-09-09T09:00:00+09:00</DateTime>
        <Duration>PT6H</Duration>
        <Name>９日０９時から１５時</Name>
      </TimeDefine>
    `
    : `
      <TimeDefine timeId="1">
        <DateTime>2026-09-11T00:00:00+09:00</DateTime>
        <Duration>P1D</Duration>
      </TimeDefine>
    `;

  const phenomenonType = isNear ? '大雨の警報級の可能性' : '雨の警報級の可能性';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/" xmlns:jmx="http://xml.kishou.go.jp/jmaxml1/" xmlns:jmx_add="http://xml.kishou.go.jp/jmaxml1/addition1/">
<Control>
  <Title>${title}</Title>
  <DateTime>2026-09-09T00:00:00Z</DateTime>
  <Status>${statusStr}</Status>
  <EditorialOffice>気象庁</EditorialOffice>
  <PublishingOffice>気象庁</PublishingOffice>
</Control>
<Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
  <Title>東京都早期注意情報</Title>
  <ReportDateTime>2026-09-09T09:00:00+09:00</ReportDateTime>
  <TargetDateTime>2026-09-09T09:00:00+09:00</TargetDateTime>
  <TargetDuration>P2DT15H</TargetDuration>
  <EventID/>
  <InfoType>発表</InfoType>
  <Serial/>
  <InfoKind>${infoKind}</InfoKind>
  <InfoKindVersion>${infoKindVersion}</InfoKindVersion>
</Head>
<Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/" xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/">
  <MeteorologicalInfos type="区域予報">
    <TimeSeriesInfo>
      <TimeDefines>
        ${timeDefinesXml}
      </TimeDefines>
      <Item>
        <Kind>
          <Property>
            <Type>${phenomenonType}</Type>
            <PossibilityRankOfWarningPart>
              <jmx_eb:PossibilityRankOfWarning refID="1" type="${phenomenonType}">高</jmx_eb:PossibilityRankOfWarning>
            </PossibilityRankOfWarningPart>
          </Property>
        </Kind>
        <Area>
          <Name>東京地方</Name>
          <Code>${areaCode}</Code>
        </Area>
      </Item>
    </TimeSeriesInfo>
  </MeteorologicalInfos>
</Body>
</Report>`;
}

function createSampleReception(
  context: ReturnType<typeof setupTestDb>['context'],
  options: {
    rawXml?: string | null;
    controlStatus?: 'normal' | 'training' | 'test';
    telegramType?: string;
    reportDateTime?: string;
    controlDateTime?: string;
    documentUrl?: string;
    areaCode?: string;
    isInvalidStructure?: boolean;
  } = {},
) {
  const attempt = recordFetchAttempt(context.connection, {
    sourceKind: 'xml_document',
    targetRef: 'regular',
    requestUrl: options.documentUrl ?? 'https://example.com/ew_test.xml',
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

  const telegramType = options.telegramType ?? 'VPFD61';
  let rawBody: string | null;
  if (options.rawXml !== undefined) {
    rawBody = options.rawXml;
  } else {
    rawBody = buildSampleEarlyWarningXml({
      telegramType: telegramType === 'VPFW60' ? 'VPFW60' : 'VPFD61',
      controlStatus: options.controlStatus,
      areaCode: options.areaCode,
      isInvalidStructure: options.isInvalidStructure,
    });
  }

  const input: TelegramReceptionInput = {
    fetchAttemptId: attempt.id,
    feedKind: 'regular',
    feedEntryId: 'entry-ew-1',
    documentUrl: options.documentUrl ?? 'https://example.com/ew_test.xml',
    telegramType,
    title: '早期注意情報',
    controlStatus: options.controlStatus ?? 'normal',
    infoType: '発表',
    eventId: null,
    serial: null,
    controlDateTime: options.controlDateTime ?? '2026-09-09T00:00:00.000Z',
    reportDateTime: options.reportDateTime ?? '2026-09-09T00:00:00.000Z',
    targetDateTime: null,
    receivedAt: '2026-09-09T00:00:01.000Z',
    adoptions: [],
    rawBody,
    bodyBytes: rawBody ? Buffer.byteLength(rawBody, 'utf-8') : 0,
    contentHash: 'hash-1234',
    areas: [{ sequence: 1, areaCode: '130010', areaName: '東京地方' }],
  };

  return recordTelegramReception(context.connection, input);
}

test('processEarlyWarningReception: VPFD61 を near として保存し、reception を同一トランザクションで更新する', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const reception = createSampleReception(context, { telegramType: 'VPFD61' });
    const processedAt = '2026-09-09T00:01:00.000Z';

    const result = processEarlyWarningReception(
      context.connection,
      reception,
      processedAt,
      DEFAULT_EARLY_WARNING_TARGET_AREA,
    );

    assert.equal(result.ok, true);

    // reception の adoption が更新されていること
    const updatedReception = findTelegramReceptionById(context.connection, reception.id);
    assert.ok(updatedReception);
    // 会場によって対象が変わらない判定のため、全 VenueId 分の行として複製される（§3.3.1）。
    assert.deepEqual(updatedReception.adoptions, [
      {
        receptionId: reception.id,
        venueId: 'east',
        adoptionResult: '早期注意情報として解析済み',
        adoptionReason: null,
        adoptionDecidedAt: processedAt,
      },
      {
        receptionId: reception.id,
        venueId: 'trc',
        adoptionResult: '早期注意情報として解析済み',
        adoptionReason: null,
        adoptionDecidedAt: processedAt,
      },
    ]);

    // snapshot が near として保存されていること
    const snapshot = findEarlyWarningSnapshot(context.connection, '130010', 'near', 'normal');
    assert.ok(snapshot);
    assert.equal(snapshot.areaCode, '130010');
    assert.equal(snapshot.areaName, '東京地方');
    assert.equal(snapshot.segment, 'near');
    assert.equal(snapshot.telegramType, 'VPFD61');
    assert.equal(snapshot.metadata.availability, 'available');
    assert.equal(snapshot.metadata.lastSuccessAt, processedAt);
    assert.equal(snapshot.metadata.issuedAt, '2026-09-09T00:00:00.000Z');
    assert.equal(snapshot.timeDefines.length, 1);
    assert.equal(snapshot.cells.length, 1);
    assert.equal(snapshot.cells[0].phenomenonCode, '大雨の警報級の可能性');
    assert.equal(snapshot.cells[0].rankValue, '高');
  } finally {
    cleanup();
  }
});

test('processEarlyWarningReception: VPFW60 を far として保存し、near と far が独立して共存する', () => {
  const { context, cleanup } = setupTestDb();
  try {
    // 1. near (VPFD61) を保存
    const receptionNear = createSampleReception(context, {
      telegramType: 'VPFD61',
      documentUrl: 'https://example.com/vpfd61.xml',
    });
    processEarlyWarningReception(
      context.connection,
      receptionNear,
      '2026-09-09T00:01:00.000Z',
      DEFAULT_EARLY_WARNING_TARGET_AREA,
    );

    const snapshotNearBefore = findEarlyWarningSnapshot(
      context.connection,
      '130010',
      'near',
      'normal',
    );
    assert.ok(snapshotNearBefore);

    // 2. far (VPFW60) を保存
    const receptionFar = createSampleReception(context, {
      telegramType: 'VPFW60',
      documentUrl: 'https://example.com/vpfw60.xml',
    });
    const resultFar = processEarlyWarningReception(
      context.connection,
      receptionFar,
      '2026-09-09T00:02:00.000Z',
      DEFAULT_EARLY_WARNING_TARGET_AREA,
    );
    assert.equal(resultFar.ok, true);

    const snapshotFar = findEarlyWarningSnapshot(context.connection, '130010', 'far', 'normal');
    assert.ok(snapshotFar);
    assert.equal(snapshotFar.segment, 'far');
    assert.equal(snapshotFar.telegramType, 'VPFW60');
    assert.equal(snapshotFar.cells[0].phenomenonCode, '雨の警報級の可能性');

    // 3. near が far 保存の影響を受けずに完全に残っていること
    const snapshotNearAfter = findEarlyWarningSnapshot(
      context.connection,
      '130010',
      'near',
      'normal',
    );
    assert.ok(snapshotNearAfter);
    assert.deepEqual(snapshotNearAfter, snapshotNearBefore);

    // 4. far 側の処理失敗が near に影響しないこと
    const invalidFarReception = createSampleReception(context, {
      telegramType: 'VPFW60',
      documentUrl: 'https://example.com/vpfw60_invalid.xml',
      isInvalidStructure: true,
    });
    const failResult = processEarlyWarningReception(
      context.connection,
      invalidFarReception,
      '2026-09-09T00:03:00.000Z',
      DEFAULT_EARLY_WARNING_TARGET_AREA,
    );
    assert.equal(failResult.ok, false);

    const snapshotNearStillIntact = findEarlyWarningSnapshot(
      context.connection,
      '130010',
      'near',
      'normal',
    );
    assert.deepEqual(snapshotNearStillIntact, snapshotNearBefore);
  } finally {
    cleanup();
  }
});

test('processEarlyWarningReception: normal / training / test が別スナップショットとして独立保存される', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const receptionNormal = createSampleReception(context, {
      telegramType: 'VPFD61',
      controlStatus: 'normal',
      documentUrl: 'https://example.com/vpfd61_normal.xml',
    });
    processEarlyWarningReception(
      context.connection,
      receptionNormal,
      '2026-09-09T00:01:00.000Z',
      DEFAULT_EARLY_WARNING_TARGET_AREA,
    );

    const receptionTraining = createSampleReception(context, {
      telegramType: 'VPFD61',
      controlStatus: 'training',
      documentUrl: 'https://example.com/vpfd61_training.xml',
    });
    processEarlyWarningReception(
      context.connection,
      receptionTraining,
      '2026-09-09T00:02:00.000Z',
      DEFAULT_EARLY_WARNING_TARGET_AREA,
    );

    const normalSnap = findEarlyWarningSnapshot(context.connection, '130010', 'near', 'normal');
    const trainingSnap = findEarlyWarningSnapshot(context.connection, '130010', 'near', 'training');

    assert.ok(normalSnap);
    assert.ok(trainingSnap);
    assert.equal(normalSnap.telegram.controlStatus, 'normal');
    assert.equal(trainingSnap.telegram.controlStatus, 'training');
    assert.notEqual(normalSnap.id, trainingSnap.id);
  } finally {
    cleanup();
  }
});

test('processEarlyWarningReception: 失敗時（対象地域外・未対応構造・rawBodyなし）は既存スナップショットを変更しない', () => {
  const { context, cleanup } = setupTestDb();
  try {
    // 既存スナップショットを直接用意
    const existingSnap = saveEarlyWarningSnapshot(context.connection, {
      areaCode: '130010',
      areaName: '東京地方',
      segment: 'near',
      telegramType: 'VPFD61',
      metadata: {
        source: 'https://example.com/initial.xml',
        issuedAt: '2026-09-09T00:00:00.000Z',
        validAt: null,
        validFrom: null,
        validTo: null,
        fetchedAt: '2026-09-09T00:00:00.000Z',
        lastSuccessAt: '2026-09-09T00:00:00.000Z',
        availability: 'available',
        sourceVersion: '1.5_0',
      },
      telegram: {
        controlStatus: 'normal',
        infoType: '発表',
        eventId: null,
        reportDateTime: '2026-09-09T00:00:00.000Z',
        controlDateTime: '2026-09-09T00:00:00.000Z',
      },
      timeDefines: [
        {
          timeId: '1',
          sequence: 1,
          timeFrom: '2026-09-09T00:00:00.000Z',
          timeTo: '2026-09-09T06:00:00.000Z',
          duration: 'PT6H',
        },
      ],
      cells: [
        {
          refId: '1',
          phenomenonCode: '大雨の警報級の可能性',
          phenomenonName: '大雨の警報級の可能性',
          rankValue: '高',
          condition: null,
        },
      ],
    });

    // 1. rawBody なし
    const noBodyReception = createSampleReception(context, {
      telegramType: 'VPFD61',
      rawXml: null,
      documentUrl: 'https://example.com/nobody.xml',
    });
    const noBodyResult = processEarlyWarningReception(
      context.connection,
      noBodyReception,
      '2026-09-09T00:05:00.000Z',
      DEFAULT_EARLY_WARNING_TARGET_AREA,
    );
    assert.equal(noBodyResult.ok, false);
    assert.equal(noBodyResult.disposition, '未対応構造');

    // 2. 対象地域外 (370000 香川県)
    const outOfAreaReception = createSampleReception(context, {
      telegramType: 'VPFD61',
      areaCode: '370000',
      documentUrl: 'https://example.com/outofarea.xml',
    });
    const outOfAreaResult = processEarlyWarningReception(
      context.connection,
      outOfAreaReception,
      '2026-09-09T00:06:00.000Z',
      DEFAULT_EARLY_WARNING_TARGET_AREA,
    );
    assert.equal(outOfAreaResult.ok, false);
    assert.equal(outOfAreaResult.disposition, '対象地域外');

    // 3. 未対応構造
    const invalidReception = createSampleReception(context, {
      telegramType: 'VPFD61',
      isInvalidStructure: true,
      documentUrl: 'https://example.com/invalid.xml',
    });
    const invalidResult = processEarlyWarningReception(
      context.connection,
      invalidReception,
      '2026-09-09T00:07:00.000Z',
      DEFAULT_EARLY_WARNING_TARGET_AREA,
    );
    assert.equal(invalidResult.ok, false);
    assert.equal(invalidResult.disposition, '未対応構造');

    // 既存スナップショットが変化していないことを確認
    const snapAfter = findEarlyWarningSnapshot(context.connection, '130010', 'near', 'normal');
    assert.ok(snapAfter);
    assert.deepEqual(snapAfter, existingSnap);
  } finally {
    cleanup();
  }
});
