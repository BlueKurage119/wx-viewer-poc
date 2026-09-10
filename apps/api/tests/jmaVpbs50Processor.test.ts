import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeDatabase } from '../src/database/index.js';
import { processVpbs50Reception } from '../src/polling/jmaVpbs50Processor.js';
import {
  findBosaiBulletin,
  listBosaiBulletins,
} from '../src/repositories/bosaiBulletinRepository.js';
import {
  findTelegramReceptionById,
  recordTelegramReception,
} from '../src/repositories/telegramReceptionRepository.js';
import type {
  BosaiBulletinTarget,
  TelegramReception,
  TelegramReceptionInput,
} from '../src/repositories/types.js';
import { resolveVenueForecastTargets } from '@wx-viewer-poc/shared';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');
const samplesDir =
  '/Users/yuta/claudeworks/cmk-gsx/docs/260907_weather-data/jmaxml_20260723_Samples';
const fixturesDir = join(apiRoot, 'tests/fixtures');

function setupTestDb() {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-vpbs50-processor-test-'));
  const databasePath = join(directory, 'test.sqlite3');
  const context = initializeDatabase({
    databasePath,
    migrationsDirectory,
  });

  return {
    context,
    cleanup: () => {
      context.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

interface BuildXmlHelperOptions {
  controlTitle?: string;
  controlStatus?: string;
  controlDateTime?: string;
  headTitle?: string;
  reportDateTime?: string;
  targetDateTime?: string;
  eventId?: string;
  infoType?: string;
  infoKind?: string;
  infoKindVersion?: string;
  omitHeadlineText?: boolean;
  headlineText?: string;
  omitInformationTag?: boolean;
  condition?: string;
  headlineAreas?: Array<{ name: string; code: string; codeType?: string }>;
  bodyAreas?: Array<{ name: string; code: string; codeType?: string }>;
}

function buildXml(options: BuildXmlHelperOptions = {}): string {
  const controlTitle = options.controlTitle ?? '府県気象防災速報';
  const controlStatus = options.controlStatus ?? '通常';
  const controlDateTime = options.controlDateTime ?? '2026-09-10T07:48:12Z';
  const headTitle = options.headTitle ?? '東京都気象防災速報（線状降水帯発生）';
  const reportDateTime = options.reportDateTime ?? '2026-09-10T17:00:00+09:00';
  const eventId = options.eventId ?? 'JPTE202609100001_202609100001';
  const infoType = options.infoType ?? '発表';
  const infoKind = options.infoKind ?? '気象解説情報';
  const infoKindVersion = options.infoKindVersion ?? '1.5_0';
  const condition = options.condition ?? '線状降水帯発生';

  let textXml = '';
  if (!options.omitHeadlineText) {
    const textContent = options.headlineText ?? '東京都東京地方では、線状降水帯が発生しました。';
    textXml = `<Text>${textContent}</Text>`;
  }

  let infoTagXml = '';
  if (!options.omitInformationTag) {
    const hlAreas =
      options.headlineAreas !== undefined
        ? options.headlineAreas
        : options.bodyAreas && options.bodyAreas.length > 0
          ? []
          : [{ name: '東京地方', code: '130010', codeType: '気象情報／府県予報区・細分区域等' }];
    const areasXml = hlAreas
      .map(
        (a) =>
          `<Areas codeType="${a.codeType ?? '気象情報／府県予報区・細分区域等'}"><Area><Name>${a.name}</Name><Code>${a.code}</Code></Area></Areas>`,
      )
      .join('');

    infoTagXml = `
      <Information type="情報タグ">
        <Item>
          <Kind>
            <Name>情報タグ</Name>
            <Condition>${condition}</Condition>
          </Kind>
          ${areasXml}
        </Item>
      </Information>
    `;
  }

  let bodyXml = '';
  const bodyAreas = options.bodyAreas ?? [];
  if (bodyAreas.length > 0) {
    const bodyItemsXml = bodyAreas
      .map(
        (a) =>
          `<MeteorologicalInfo><Item><Area codeType="${a.codeType ?? '気象・地震・火山情報／市町村等'}"><Name>${a.name}</Name><Code>${a.code}</Code></Area></Item></MeteorologicalInfo>`,
      )
      .join('');
    bodyXml = `
      <Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/">
        <MeteorologicalInfos type="観測実況">
          ${bodyItemsXml}
        </MeteorologicalInfos>
      </Body>
    `;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
  <Control>
    <Title>${controlTitle}</Title>
    <DateTime>${controlDateTime}</DateTime>
    <Status>${controlStatus}</Status>
  </Control>
  <Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
    <Title>${headTitle}</Title>
    <ReportDateTime>${reportDateTime}</ReportDateTime>
    <TargetDateTime>${options.targetDateTime ?? reportDateTime}</TargetDateTime>
    <EventID>${eventId}</EventID>
    <InfoType>${infoType}</InfoType>
    <InfoKind>${infoKind}</InfoKind>
    <InfoKindVersion>${infoKindVersion}</InfoKindVersion>
    <Headline>
      ${textXml}
      ${infoTagXml}
    </Headline>
  </Head>
  ${bodyXml}
</Report>`;
}

function createSampleReception(
  context: ReturnType<typeof setupTestDb>['context'],
  options: {
    rawBody: string;
    documentUrl?: string;
    controlDateTime?: string;
    reportDateTime?: string;
    controlStatus?: 'normal' | 'training' | 'test';
    receivedAt?: string;
  },
): TelegramReception {
  const input: TelegramReceptionInput = {
    fetchAttemptId: null,
    feedKind: 'regular',
    feedEntryId: 'entry-1',
    documentUrl: options.documentUrl ?? 'https://example.com/vpbs50.xml',
    telegramType: 'VPBS50',
    title: '気象防災速報',
    controlStatus: options.controlStatus ?? 'normal',
    infoType: '発表',
    eventId: 'JPTE202609100001_202609100001',
    serial: '1',
    controlDateTime: options.controlDateTime ?? '2026-09-10T07:48:12.000Z',
    reportDateTime: options.reportDateTime ?? '2026-09-10T08:00:00.000Z',
    targetDateTime: '2026-09-10T08:00:00.000Z',
    receivedAt: options.receivedAt ?? '2026-09-10T07:50:00.000Z',
    adoptionResult: null,
    adoptionReason: null,
    adoptionDecidedAt: null,
    rawBody: options.rawBody,
    bodyBytes: Buffer.byteLength(options.rawBody, 'utf-8'),
    contentHash: 'hash-1',
    areas: [],
  };

  return recordTelegramReception(context.connection, input);
}

test('受け入れ条件19: 正常系保存とメタデータ (valid_to が null、report_datetime / fetched_at の一致)', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const rawXml = buildXml({
      eventId: 'EVENT_20260910_01',
      reportDateTime: '2026-09-10T17:00:00+09:00', // -> 2026-09-10T08:00:00.000Z
      controlDateTime: '2026-09-10T07:48:12Z', // -> 2026-09-10T07:48:12.000Z
      headlineText: '東京都江東区で猛烈な雨',
      headlineAreas: [
        { name: '江東区', code: '1310800', codeType: '気象・地震・火山情報／市町村等' },
      ],
    });

    const reception = createSampleReception(context, {
      rawBody: rawXml,
      documentUrl: 'https://example.com/test-doc-1.xml',
      receivedAt: '2026-09-10T07:49:00.000Z',
    });

    const processedAt = '2026-09-10T07:55:00.000Z';
    const result = processVpbs50Reception(context.connection, reception, processedAt);
    assert.equal(result.ok, true);

    // reception の adoption 更新確認
    const updatedReception = findTelegramReceptionById(context.connection, reception.id);
    assert.ok(updatedReception);
    assert.equal(updatedReception.adoptionResult, '気象防災速報として解析済み');
    assert.equal(updatedReception.adoptionReason, null);
    assert.equal(updatedReception.adoptionDecidedAt, processedAt);

    // DB 保存行の確認
    const bulletin = findBosaiBulletin(context.connection, 'EVENT_20260910_01', 'normal');
    assert.ok(bulletin);
    assert.equal(bulletin.eventId, 'EVENT_20260910_01');
    assert.equal(bulletin.headlineText, '東京都江東区で猛烈な雨');
    assert.equal(bulletin.informationTag, '線状降水帯発生');
    assert.equal(bulletin.isCancelled, false);
    assert.equal(bulletin.reportDateTime, '2026-09-10T08:00:00.000Z');
    assert.equal(bulletin.controlDateTime, '2026-09-10T07:48:12.000Z');

    // メタデータ確認
    assert.equal(bulletin.metadata.source, 'https://example.com/test-doc-1.xml');
    assert.equal(bulletin.metadata.issuedAt, '2026-09-10T08:00:00.000Z');
    assert.equal(bulletin.metadata.validTo, null, 'valid_to は null であること');
    assert.equal(bulletin.metadata.fetchedAt, '2026-09-10T07:49:00.000Z');
    assert.equal(bulletin.metadata.lastSuccessAt, processedAt);
    assert.equal(bulletin.metadata.availability, 'available');
  } finally {
    cleanup();
  }
});

test('受け入れ条件6: 公式サンプル 82_03_01/02/03_260324_VPBS50.xml (同一親番3件) が3行並存し上書きされない', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const samples = [
      {
        file: '82_03_01_260324_VPBS50.xml',
        expectedEventId: 'JPFK202307100159_202307100159',
        reportDt: '2023-07-09T16:59:00.000Z',
        ctrlDt: '2023-07-09T16:58:55.000Z',
      },
      {
        file: '82_03_02_260324_VPBS50.xml',
        expectedEventId: 'JPFK202307100159_202307100209',
        reportDt: '2023-07-09T17:09:00.000Z',
        ctrlDt: '2023-07-09T17:08:55.000Z',
      },
      {
        file: '82_03_03_260324_VPBS50.xml',
        expectedEventId: 'JPFK202307100159_202307100329',
        reportDt: '2023-07-09T18:29:00.000Z',
        ctrlDt: '2023-07-09T18:28:55.000Z',
      },
    ];

    const fukuokaTarget: BosaiBulletinTarget = {
      includedAreaCodes: ['400010', '400020', '400040'],
    };

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]!;
      const samplePath = join(samplesDir, s.file);
      if (!existsSync(samplePath)) return;

      const xml = readFileSync(samplePath, 'utf-8');
      const reception = createSampleReception(context, {
        rawBody: xml,
        controlDateTime: s.ctrlDt,
        reportDateTime: s.reportDt,
        documentUrl: `https://example.com/${s.file}`,
      });

      const res = processVpbs50Reception(
        context.connection,
        reception,
        '2026-09-10T10:00:00.000Z',
        fukuokaTarget,
      );
      assert.equal(res.ok, true);
    }

    // 3行が独立して存在することを確認
    const all = listBosaiBulletins(context.connection, { controlStatus: 'normal' });
    assert.equal(all.length, 3, '3件の速報が全て並存していること');

    const eventIds = all.map((b) => b.eventId).sort();
    assert.deepEqual(eventIds, [
      'JPFK202307100159_202307100159',
      'JPFK202307100159_202307100209',
      'JPFK202307100159_202307100329',
    ]);
  } finally {
    cleanup();
  }
});

test('受け入れ条件7, 8: 更新判定 (Control/DateTime の比較、同一/古い場合はスキップ、ReportDateTime同一の訂正は更新)', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const eventId = 'EVENT_UPDATE_TEST_01';

    // 1. 初回電文投入 (ctrlDt: 2026-09-10T07:00:00Z)
    const xml1 = buildXml({
      eventId,
      controlDateTime: '2026-09-10T07:00:00Z',
      reportDateTime: '2026-09-10T16:00:00+09:00', // 07:00:00Z
      headlineText: '第1報',
      headlineAreas: [{ name: '江東区', code: '1310800' }],
    });
    const rec1 = createSampleReception(context, {
      rawBody: xml1,
      controlDateTime: '2026-09-10T07:00:00.000Z',
      reportDateTime: '2026-09-10T07:00:00.000Z',
    });
    processVpbs50Reception(context.connection, rec1, '2026-09-10T07:05:00.000Z');

    const b1 = findBosaiBulletin(context.connection, eventId, 'normal');
    assert.ok(b1);
    assert.equal(b1.headlineText, '第1報');

    // 2. Control/DateTime が同じ電文の再投入 -> スキップ (重複または旧版)
    const recSame = createSampleReception(context, {
      rawBody: xml1,
      controlDateTime: '2026-09-10T07:00:00.000Z',
      reportDateTime: '2026-09-10T07:00:00.000Z',
      documentUrl: 'https://example.com/same.xml',
    });
    processVpbs50Reception(context.connection, recSame, '2026-09-10T07:06:00.000Z');

    const updatedRecSame = findTelegramReceptionById(context.connection, recSame.id);
    assert.equal(updatedRecSame?.adoptionResult, '重複または旧版');

    // 3. Control/DateTime が古い電文の投入 -> スキップ (重複または旧版)
    const xmlOld = buildXml({
      eventId,
      controlDateTime: '2026-09-10T06:50:00Z',
      reportDateTime: '2026-09-10T16:00:00+09:00',
      headlineText: '古い電文',
      headlineAreas: [{ name: '江東区', code: '1310800' }],
    });
    const recOld = createSampleReception(context, {
      rawBody: xmlOld,
      controlDateTime: '2026-09-10T06:50:00.000Z',
      reportDateTime: '2026-09-10T07:00:00.000Z',
    });
    processVpbs50Reception(context.connection, recOld, '2026-09-10T07:07:00.000Z');

    const updatedRecOld = findTelegramReceptionById(context.connection, recOld.id);
    assert.equal(updatedRecOld?.adoptionResult, '重複または旧版');

    // 既存行が変わっていないことを確認
    const bAfterOld = findBosaiBulletin(context.connection, eventId, 'normal');
    assert.equal(bAfterOld?.headlineText, '第1報');

    // 4. ReportDateTime が同じで Control/DateTime のみ新しい訂正電文 -> 正しく更新される
    const xmlNew = buildXml({
      eventId,
      controlDateTime: '2026-09-10T07:15:00Z',
      reportDateTime: '2026-09-10T16:00:00+09:00', // ReportDateTime は同一 (07:00:00Z)
      infoType: '訂正',
      headlineText: '第1報（訂正）',
      headlineAreas: [
        { name: '江東区', code: '1310800' },
        { name: '東京地方', code: '130010' },
      ],
    });
    const recNew = createSampleReception(context, {
      rawBody: xmlNew,
      controlDateTime: '2026-09-10T07:15:00.000Z',
      reportDateTime: '2026-09-10T07:00:00.000Z',
    });
    processVpbs50Reception(context.connection, recNew, '2026-09-10T07:16:00.000Z');

    const updatedRecNew = findTelegramReceptionById(context.connection, recNew.id);
    assert.equal(updatedRecNew?.adoptionResult, '気象防災速報として解析済み');

    const bUpdated = findBosaiBulletin(context.connection, eventId, 'normal');
    assert.ok(bUpdated);
    assert.equal(bUpdated.infoType, '訂正');
    assert.equal(bUpdated.headlineText, '第1報（訂正）');
    assert.equal(bUpdated.controlDateTime, '2026-09-10T07:15:00.000Z');
    assert.equal(bUpdated.areas.length, 2);

    // 行数が増えていないこと（1行のみ）
    const all = listBosaiBulletins(context.connection, { controlStatus: 'normal' });
    assert.equal(all.length, 1);
  } finally {
    cleanup();
  }
});

test('受け入れ条件3: 負例実データ (20260905220832_0_VPBS50_130000.xml) は保存されず、会場一覧に混入しない', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const fixturePath = join(fixturesDir, '20260905220832_0_VPBS50_130000.xml');
    const xml = readFileSync(fixturePath, 'utf-8');

    const reception = createSampleReception(context, {
      rawBody: xml,
      controlDateTime: '2026-09-05T22:08:31.000Z',
      reportDateTime: '2026-09-05T22:08:00.000Z',
    });

    const result = processVpbs50Reception(
      context.connection,
      reception,
      '2026-09-06T00:00:00.000Z',
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.disposition, '対象地域外');
    }

    const updatedReception = findTelegramReceptionById(context.connection, reception.id);
    assert.equal(updatedReception?.adoptionResult, '対象地域外');

    // bosai_bulletin に行が1件も作られないこと
    const all = listBosaiBulletins(context.connection, { controlStatus: 'normal' });
    assert.equal(all.length, 0);

    // east 絞り込みでも空
    const eastTargets = resolveVenueForecastTargets('east').bosaiBulletin.includedAreaCodes;
    const eastList = listBosaiBulletins(context.connection, {
      controlStatus: 'normal',
      includedAreaCodes: eastTargets,
    });
    assert.equal(eastList.length, 0);
  } finally {
    cleanup();
  }
});

test('受け入れ条件4: 江東区・大田区・東京地方の各速報が採用され、会場ごとの絞り込みで正しく分かれる', () => {
  const { context, cleanup } = setupTestDb();
  try {
    // 1. 江東区 (1310800) を Body に持つ速報
    const xmlKoto = buildXml({
      eventId: 'EVENT_KOTO',
      headlineText: '江東区速報',
      bodyAreas: [{ name: '江東区', code: '1310800', codeType: '気象・地震・火山情報／市町村等' }],
    });
    const recKoto = createSampleReception(context, { rawBody: xmlKoto });
    processVpbs50Reception(context.connection, recKoto, '2026-09-10T08:00:00.000Z');

    // 2. 大田区 (1311100) を Body に持つ速報
    const xmlOta = buildXml({
      eventId: 'EVENT_OTA',
      headlineText: '大田区速報',
      bodyAreas: [{ name: '大田区', code: '1311100', codeType: '気象・地震・火山情報／市町村等' }],
    });
    const recOta = createSampleReception(context, { rawBody: xmlOta });
    processVpbs50Reception(context.connection, recOta, '2026-09-10T08:00:00.000Z');

    // 3. 東京地方 (130010) のみを持つ速報
    const xmlTokyo = buildXml({
      eventId: 'EVENT_TOKYO',
      headlineText: '東京地方速報',
      headlineAreas: [
        { name: '東京地方', code: '130010', codeType: '気象情報／府県予報区・細分区域等' },
      ],
    });
    const recTokyo = createSampleReception(context, { rawBody: xmlTokyo });
    processVpbs50Reception(context.connection, recTokyo, '2026-09-10T08:00:00.000Z');

    // 全件は3件
    const all = listBosaiBulletins(context.connection, { controlStatus: 'normal' });
    assert.equal(all.length, 3);

    // east 絞り込み (江東区 1310800, 23区東部 130012, 東京地方 130010)
    const eastTargets = resolveVenueForecastTargets('east').bosaiBulletin.includedAreaCodes;
    const eastList = listBosaiBulletins(context.connection, {
      controlStatus: 'normal',
      includedAreaCodes: eastTargets,
    });
    assert.equal(eastList.length, 2);
    const eastEventIds = eastList.map((b) => b.eventId).sort();
    assert.deepEqual(eastEventIds, ['EVENT_KOTO', 'EVENT_TOKYO']);

    // trc 絞り込み (大田区 1311100, 23区南部 130011, 東京地方 130010)
    const trcTargets = resolveVenueForecastTargets('trc').bosaiBulletin.includedAreaCodes;
    const trcList = listBosaiBulletins(context.connection, {
      controlStatus: 'normal',
      includedAreaCodes: trcTargets,
    });
    assert.equal(trcList.length, 2);
    const trcEventIds = trcList.map((b) => b.eventId).sort();
    assert.deepEqual(trcEventIds, ['EVENT_OTA', 'EVENT_TOKYO']);
  } finally {
    cleanup();
  }
});

test('受け入れ条件12, 13: 取消電文で is_cancelled=1 に更新され、欠落要素が NULL で保存される (引き継ぎなし)', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const eventId = 'EVENT_CANCEL_TEST';

    // 1. 発表電文の保存
    const xmlInitial = buildXml({
      eventId,
      controlDateTime: '2026-09-10T07:00:00Z',
      headlineText: '初期本文',
      condition: '線状降水帯発生',
      headlineAreas: [{ name: '江東区', code: '1310800' }],
    });
    const recInitial = createSampleReception(context, {
      rawBody: xmlInitial,
      controlDateTime: '2026-09-10T07:00:00.000Z',
    });
    processVpbs50Reception(context.connection, recInitial, '2026-09-10T07:01:00.000Z');

    const bBefore = findBosaiBulletin(context.connection, eventId, 'normal');
    assert.ok(bBefore);
    assert.equal(bBefore.headlineText, '初期本文');
    assert.equal(bBefore.informationTag, '線状降水帯発生');
    assert.equal(bBefore.isCancelled, false);

    // 2. 取消電文 (Text 欠落、情報タグ欠落、Body に江東区)
    const xmlCancel = buildXml({
      eventId,
      controlDateTime: '2026-09-10T07:10:00Z',
      infoType: '取消',
      headTitle: '東京都気象防災速報（取消）',
      omitHeadlineText: true,
      omitInformationTag: true,
      bodyAreas: [{ name: '江東区', code: '1310800', codeType: '気象・地震・火山情報／市町村等' }],
    });
    const recCancel = createSampleReception(context, {
      rawBody: xmlCancel,
      controlDateTime: '2026-09-10T07:10:00.000Z',
    });
    processVpbs50Reception(context.connection, recCancel, '2026-09-10T07:11:00.000Z');

    // 行が削除されず更新されていること
    const bAfter = findBosaiBulletin(context.connection, eventId, 'normal');
    assert.ok(bAfter);
    assert.equal(bAfter.infoType, '取消');
    assert.equal(bAfter.isCancelled, true);
    assert.equal(bAfter.headlineText, null, '初期本文が引き継がれず NULL になること');
    assert.equal(bAfter.informationTag, null, '情報タグが引き継がれず NULL になること');
    assert.notEqual(
      bAfter.headlineText,
      '東京都気象防災速報（取消）',
      'Head/Title が代入されていないこと',
    );
  } finally {
    cleanup();
  }
});

test('受け入れ条件16: Control/Status が 訓練 / 試験 の場合は normal 行を上書きせず別行となる', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const eventId = 'EVENT_TRAINING_TEST';

    // 1. 通常電文の投入
    const xmlNormal = buildXml({
      eventId,
      controlStatus: '通常',
      headlineText: '通常本文',
      headlineAreas: [{ name: '江東区', code: '1310800' }],
    });
    const recNormal = createSampleReception(context, {
      rawBody: xmlNormal,
      controlStatus: 'normal',
    });
    processVpbs50Reception(context.connection, recNormal, '2026-09-10T08:00:00.000Z');

    // 2. 同一 EventID の訓練電文の投入
    const xmlTraining = buildXml({
      eventId,
      controlStatus: '訓練',
      headlineText: '訓練本文',
      headlineAreas: [{ name: '江東区', code: '1310800' }],
    });
    const recTraining = createSampleReception(context, {
      rawBody: xmlTraining,
      controlStatus: 'training',
    });
    processVpbs50Reception(context.connection, recTraining, '2026-09-10T08:01:00.000Z');

    // 3. 同一 EventID の試験電文の投入
    const xmlTest = buildXml({
      eventId,
      controlStatus: '試験',
      headlineText: '試験本文',
      headlineAreas: [{ name: '江東区', code: '1310800' }],
    });
    const recTest = createSampleReception(context, {
      rawBody: xmlTest,
      controlStatus: 'test',
    });
    processVpbs50Reception(context.connection, recTest, '2026-09-10T08:02:00.000Z');

    // 3行が独立して存在し、normal が書き換わっていないこと
    const bNormal = findBosaiBulletin(context.connection, eventId, 'normal');
    assert.ok(bNormal);
    assert.equal(bNormal.headlineText, '通常本文');
    assert.equal(bNormal.controlStatus, 'normal');

    const bTraining = findBosaiBulletin(context.connection, eventId, 'training');
    assert.ok(bTraining);
    assert.equal(bTraining.headlineText, '訓練本文');
    assert.equal(bTraining.controlStatus, 'training');

    const bTest = findBosaiBulletin(context.connection, eventId, 'test');
    assert.ok(bTest);
    assert.equal(bTest.headlineText, '試験本文');
    assert.equal(bTest.controlStatus, 'test');
  } finally {
    cleanup();
  }
});

test('受け入れ条件20: saveBosaiBulletin 失敗時に adoption も更新されない (トランザクションの原子性)', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const rawXml = buildXml({
      eventId: 'EVENT_ROLLBACK_TEST',
      headlineAreas: [{ name: '江東区', code: '1310800' }],
    });
    const reception = createSampleReception(context, { rawBody: rawXml });

    // saveBosaiBulletin を意図的に例外送出させるため、テーブルにトリガー等でエラーを仕掛ける
    context.connection.exec(`
      CREATE TRIGGER fail_bulletin_insert
      BEFORE INSERT ON bosai_bulletin
      BEGIN
        SELECT RAISE(FAIL, 'DB insert failure simulation');
      END;
    `);

    assert.throws(
      () => processVpbs50Reception(context.connection, reception, '2026-09-10T08:00:00.000Z'),
      /DB insert failure simulation/,
    );

    // adoption が更新されていないこと（null のまま）
    const rec = findTelegramReceptionById(context.connection, reception.id);
    assert.ok(rec);
    assert.equal(rec.adoptionResult, null);
    assert.equal(rec.adoptionDecidedAt, null);
  } finally {
    cleanup();
  }
});

test('原文なし (rawBody=null) の場合は未対応構造として adoption が更新される', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const reception = createSampleReception(context, { rawBody: '' });
    // rawBody を強制的に null 相当にするため直接更新
    context.connection
      .prepare('UPDATE telegram_reception SET raw_body = NULL WHERE id = ?')
      .run(reception.id);
    const nullBodyReception = findTelegramReceptionById(context.connection, reception.id)!;

    const result = processVpbs50Reception(
      context.connection,
      nullBodyReception,
      '2026-09-10T08:00:00.000Z',
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.disposition, '未対応構造');
    }

    const updated = findTelegramReceptionById(context.connection, reception.id);
    assert.equal(updated?.adoptionResult, '未対応構造');
  } finally {
    cleanup();
  }
});
