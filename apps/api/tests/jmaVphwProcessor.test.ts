import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeDatabase } from '../src/database/index.js';
import { processVphwReception } from '../src/polling/jmaVphwProcessor.js';
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
  VphwTelegramType,
} from '../src/repositories/types.js';
import { resolveVenueForecastTargets } from '@wx-viewer-poc/shared';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');
const samplesDir =
  '/Users/yuta/claudeworks/cmk-gsx/docs/260907_weather-data/jmaxml_20260723_Samples';

function setupTestDb() {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-vphw-processor-test-'));
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

interface BuildVphwXmlOptions {
  telegramType?: VphwTelegramType;
  controlTitle?: string;
  controlStatus?: string;
  controlDateTime?: string;
  headTitle?: string;
  reportDateTime?: string;
  validDateTime?: string | null;
  omitValidDateTime?: boolean;
  eventId?: string;
  infoType?: string;
  infoKind?: string;
  infoKindVersion?: string;
  omitHeadlineText?: boolean;
  headlineText?: string;
  omitSaibunInfo?: boolean;
  saibunAreaCode?: string;
  saibunAreaName?: string;
  includeSightingInfo?: boolean;
  sightingAreas?: Array<{ name: string; code: string; codeType?: string }>;
}

/** 公式サンプル 19_01_01_091210_VPHW50.xml をベースとした合成 XML ビルダー */
function buildVphwXml(options: BuildVphwXmlOptions = {}): string {
  const tType = options.telegramType ?? 'VPHW50';
  const controlTitle =
    options.controlTitle ?? (tType === 'VPHW50' ? '竜巻注意情報' : '竜巻注意情報（目撃情報付き）');
  const controlStatus = options.controlStatus ?? '通常';
  const controlDateTime = options.controlDateTime ?? '2009-08-09T22:38:36Z';
  const headTitle = options.headTitle ?? '東京都竜巻注意情報';
  const reportDateTime = options.reportDateTime ?? '2009-08-10T07:38:00+09:00';
  const eventId = options.eventId ?? '';
  const infoType = options.infoType ?? '発表';
  const infoKind = options.infoKind ?? '竜巻注意情報';
  const infoKindVersion = options.infoKindVersion ?? (tType === 'VPHW50' ? '1.0_0' : '1.1_0');

  let validDtXml = '';
  if (!options.omitValidDateTime) {
    const vVal = options.validDateTime ?? '2009-08-10T08:40:00+09:00';
    validDtXml = `<ValidDateTime>${vVal}</ValidDateTime>`;
  }

  let textXml = '';
  if (!options.omitHeadlineText) {
    const textContent =
      options.headlineText ??
      '東京地方は、竜巻などの激しい突風が発生しやすい気象状況になっています。';
    textXml = `<Text>${textContent}</Text>`;
  }

  // 1. 発表細分
  let saibunXml = '';
  if (!options.omitSaibunInfo) {
    const code = options.saibunAreaCode ?? '130010';
    const name = options.saibunAreaName ?? '東京地方';
    saibunXml = `
      <Information type="竜巻注意情報（発表細分）">
        <Item>
          <Kind><Name>竜巻注意情報</Name><Code>01</Code><Condition>発表</Condition></Kind>
          <Areas codeType="気象情報／府県予報区・細分区域等">
            <Area><Name>${name}</Name><Code>${code}</Code></Area>
          </Areas>
        </Item>
      </Information>
    `;
  }

  // 2. 一次細分区域等
  const ichijiXml = `
    <Information type="竜巻注意情報（一次細分区域等）">
      <Item>
        <Kind><Name>竜巻注意情報</Name><Code>01</Code><Condition>発表</Condition></Kind>
        <Areas codeType="気象情報／府県予報区・細分区域等">
          <Area><Name>東京地方</Name><Code>130010</Code></Area>
        </Areas>
      </Item>
    </Information>
  `;

  // 3. 市町村等をまとめた地域等
  const matometaXml = `
    <Information type="竜巻注意情報（市町村等をまとめた地域等）">
      <Item>
        <Kind><Name>竜巻注意情報</Name><Code>01</Code><Condition>発表</Condition></Kind>
        <Areas codeType="気象情報／府県予報区・細分区域等">
          <Area><Name>２３区東部</Name><Code>130012</Code></Area>
        </Areas>
      </Item>
    </Information>
  `;

  // 4. 市町村等
  const shichosonXml = `
    <Information type="竜巻注意情報（市町村等）">
      <Item>
        <Kind><Name>竜巻注意情報</Name><Code>01</Code><Condition>発表</Condition></Kind>
        <Areas codeType="気象・地震・火山情報／市町村等">
          <Area><Name>江東区</Name><Code>1310800</Code></Area>
        </Areas>
      </Item>
      <Item>
        <Kind><Name>竜巻注意情報</Name><Code>01</Code><Condition>発表</Condition></Kind>
        <Areas codeType="気象・地震・火山情報／市町村等">
          <Area><Name>大田区</Name><Code>1311100</Code></Area>
        </Areas>
      </Item>
    </Information>
  `;

  // 5. 目撃情報あり（任意）
  let sightingXml = '';
  if (options.includeSightingInfo) {
    const sAreas = options.sightingAreas ?? [
      { name: '江東区', code: '1310800', codeType: '気象情報／府県予報区・細分区域等' },
    ];
    const sAreasXml = sAreas
      .map(
        (a) =>
          `<Areas codeType="${a.codeType ?? '気象情報／府県予報区・細分区域等'}"><Area><Name>${a.name}</Name><Code>${a.code}</Code></Area></Areas>`,
      )
      .join('');
    sightingXml = `
      <Information type="竜巻注意情報（目撃情報あり）">
        <Item>
          <Kind><Name>竜巻注意情報</Name><Code>01</Code><Condition>発表</Condition></Kind>
          ${sAreasXml}
        </Item>
      </Information>
    `;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
  <Control>
    <Title>${controlTitle}</Title>
    <DateTime>${controlDateTime}</DateTime>
    <Status>${controlStatus}</Status>
    <EditorialOffice>気象庁本庁</EditorialOffice>
    <PublishingOffice>気象庁予報部</PublishingOffice>
  </Control>
  <Head xmlns="http://xml.kishou.go.jp/jmaxml1/informationBasis1/">
    <Title>${headTitle}</Title>
    <ReportDateTime>${reportDateTime}</ReportDateTime>
    <TargetDateTime>${reportDateTime}</TargetDateTime>
    <EventID>${eventId}</EventID>
    <InfoType>${infoType}</InfoType>
    <Serial>1</Serial>
    <InfoKind>${infoKind}</InfoKind>
    <InfoKindVersion>${infoKindVersion}</InfoKindVersion>
    ${validDtXml}
    <Headline>
      ${textXml}
      ${saibunXml}
      ${ichijiXml}
      ${matometaXml}
      ${shichosonXml}
      ${sightingXml}
    </Headline>
  </Head>
  <Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/">
    <Warning type="竜巻注意情報">
      <Item>
        <Kind><Name>竜巻注意情報</Name><Code>01</Code><Status>なし</Status></Kind>
        <Area><Name>伊豆諸島北部</Name><Code>130020</Code></Area>
      </Item>
    </Warning>
  </Body>
</Report>`;
}

function createSampleReception(
  context: ReturnType<typeof setupTestDb>['context'],
  options: {
    rawBody: string;
    telegramType?: string;
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
    documentUrl: options.documentUrl ?? 'https://example.com/19_01_01_091210_VPHW50.xml',
    telegramType: options.telegramType ?? 'VPHW50',
    title: '竜巻注意情報',
    controlStatus: options.controlStatus ?? 'normal',
    infoType: '発表',
    eventId: null,
    serial: '1',
    controlDateTime: options.controlDateTime ?? '2009-08-09T22:38:36.000Z',
    reportDateTime: options.reportDateTime ?? '2009-08-09T22:38:00.000Z',
    targetDateTime: '2009-08-09T22:38:00.000Z',
    receivedAt: options.receivedAt ?? '2009-08-09T22:39:00.000Z',
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

test('受け入れ条件 (processor・保存・メタデータ): 19_01_01_091210_VPHW50.xml の保存とメタデータ (valid_to が NULL、valid_at が ValidDateTime)', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const samplePath = join(samplesDir, '19_01_01_091210_VPHW50.xml');
    assert.ok(existsSync(samplePath));
    const xml = readFileSync(samplePath, 'utf-8');

    const reception = createSampleReception(context, {
      rawBody: xml,
      telegramType: 'VPHW50',
      documentUrl: 'https://example.com/19_01_01_091210_VPHW50.xml',
      controlDateTime: '2009-08-09T22:38:00.000Z',
      reportDateTime: '2009-08-09T22:38:00.000Z',
      receivedAt: '2009-08-09T22:39:00.000Z',
    });

    const processedAt = '2009-08-09T22:40:00.000Z';
    const result = processVphwReception(context.connection, reception, processedAt);
    assert.equal(result.ok, true);

    // reception の adoption 更新確認
    const updatedReception = findTelegramReceptionById(context.connection, reception.id);
    assert.ok(updatedReception);
    assert.equal(updatedReception.adoptionResult, '気象防災速報として解析済み');
    assert.equal(updatedReception.adoptionReason, null);
    assert.equal(updatedReception.adoptionDecidedAt, processedAt);

    // DB 保存行の確認
    const bulletin = findBosaiBulletin(context.connection, 'VPHW50:130010', 'normal');
    assert.ok(bulletin);
    assert.equal(bulletin.eventId, 'VPHW50:130010');
    assert.equal(bulletin.title, '東京都竜巻注意情報');
    assert.equal(bulletin.informationTag, '竜巻注意情報');
    assert.equal(bulletin.hasSighting, null);
    assert.equal(bulletin.isCancelled, false);
    assert.equal(bulletin.reportDateTime, '2009-08-09T22:38:00.000Z');
    assert.equal(bulletin.controlDateTime, '2009-08-09T22:38:00.000Z');

    // メタデータ確認
    assert.equal(bulletin.metadata.source, 'https://example.com/19_01_01_091210_VPHW50.xml');
    assert.equal(bulletin.metadata.issuedAt, '2009-08-09T22:38:00.000Z');
    assert.equal(bulletin.metadata.validAt, '2009-08-09T23:40:00.000Z');
    assert.equal(bulletin.metadata.validFrom, null);
    assert.equal(bulletin.metadata.validTo, null, '確定事項#6: valid_to は常に NULL であること');
    assert.equal(bulletin.metadata.fetchedAt, '2009-08-09T22:39:00.000Z');
    assert.equal(bulletin.metadata.lastSuccessAt, processedAt);
    assert.equal(bulletin.metadata.availability, 'available');
    assert.equal(bulletin.metadata.sourceVersion, '1.0_0');

    // valid_to が NULL であることの SQL 検証
    const nonNullValidToCount = (
      context.connection
        .prepare('SELECT count(*) as count FROM bosai_bulletin WHERE valid_to IS NOT NULL')
        .get() as { count: number }
    ).count;
    assert.equal(nonNullValidToCount, 0, 'valid_to IS NOT NULL の行が0件であること');
  } finally {
    cleanup();
  }
});

test('受け入れ条件 (processor・更新): 同一発表細分区域・同一電文種別の続報投入で上書きされ行数が増えない (確定事項#8)', () => {
  const { context, cleanup } = setupTestDb();
  try {
    // 1. 初回発表投入
    // 公式サンプル 19_01_01 を加工した合成データ
    const xml1 = buildVphwXml({
      telegramType: 'VPHW50',
      controlDateTime: '2009-08-09T22:38:36Z',
      reportDateTime: '2009-08-10T07:38:00+09:00', // 22:38:00Z
      validDateTime: '2009-08-10T08:40:00+09:00', // 23:40:00Z
      headlineText: '第1報',
    });
    const rec1 = createSampleReception(context, {
      rawBody: xml1,
      telegramType: 'VPHW50',
      controlDateTime: '2009-08-09T22:38:36.000Z',
      reportDateTime: '2009-08-09T22:38:00.000Z',
    });
    processVphwReception(context.connection, rec1, '2009-08-09T22:40:00.000Z');

    const b1 = findBosaiBulletin(context.connection, 'VPHW50:130010', 'normal');
    assert.ok(b1);
    assert.equal(b1.headlineText, '第1報');

    // 2. Control/DateTime が同一の電文投入 -> スキップ (重複または旧版)
    const recSame = createSampleReception(context, {
      rawBody: xml1,
      telegramType: 'VPHW50',
      controlDateTime: '2009-08-09T22:38:36.000Z',
      reportDateTime: '2009-08-09T22:38:00.000Z',
      documentUrl: 'https://example.com/same.xml',
    });
    processVphwReception(context.connection, recSame, '2009-08-09T22:41:00.000Z');

    const updatedRecSame = findTelegramReceptionById(context.connection, recSame.id);
    assert.equal(updatedRecSame?.adoptionResult, '重複または旧版');

    // 3. Control/DateTime が古い電文投入 -> スキップ (重複または旧版)
    const xmlOld = buildVphwXml({
      telegramType: 'VPHW50',
      controlDateTime: '2009-08-09T22:20:00Z',
      reportDateTime: '2009-08-10T07:20:00+09:00',
      headlineText: '古い電文',
    });
    const recOld = createSampleReception(context, {
      rawBody: xmlOld,
      telegramType: 'VPHW50',
      controlDateTime: '2009-08-09T22:20:00.000Z',
      reportDateTime: '2009-08-09T22:20:00.000Z',
      documentUrl: 'https://example.com/old.xml',
    });
    processVphwReception(context.connection, recOld, '2009-08-09T22:42:00.000Z');

    const updatedRecOld = findTelegramReceptionById(context.connection, recOld.id);
    assert.equal(updatedRecOld?.adoptionResult, '重複または旧版');

    // 4. 新しい Control/DateTime・新しい ReportDateTime の続報 (第2報)
    const xml2 = buildVphwXml({
      telegramType: 'VPHW50',
      controlDateTime: '2009-08-09T23:38:00Z',
      reportDateTime: '2009-08-10T08:38:00+09:00', // 23:38:00Z
      validDateTime: '2009-08-10T09:40:00+09:00', // 2009-08-10T00:40:00Z
      headlineText: '第2報（続報）',
    });
    const rec2 = createSampleReception(context, {
      rawBody: xml2,
      telegramType: 'VPHW50',
      controlDateTime: '2009-08-09T23:38:00.000Z',
      reportDateTime: '2009-08-09T23:38:00.000Z',
      documentUrl: 'https://example.com/second.xml',
    });
    processVphwReception(context.connection, rec2, '2009-08-09T23:40:00.000Z');

    const bUpdated = findBosaiBulletin(context.connection, 'VPHW50:130010', 'normal');
    assert.ok(bUpdated);
    assert.equal(bUpdated.headlineText, '第2報（続報）');
    assert.equal(bUpdated.controlDateTime, '2009-08-09T23:38:00.000Z');
    assert.equal(bUpdated.reportDateTime, '2009-08-09T23:38:00.000Z');
    assert.equal(bUpdated.metadata.validAt, '2009-08-10T00:40:00.000Z');

    // 行数が増えていないこと（確定事項#8）
    const all = listBosaiBulletins(context.connection, { controlStatus: 'normal' });
    assert.equal(all.length, 1, '同一発表細分区域の続報は上書きされ1行のままであること');
  } finally {
    cleanup();
  }
});

test('受け入れ条件 (processor・2行並存): 19_10_01_150916_VPHW50 と 19_10_02_150916_VPHW51 が2行並存し互いを上書きしない (確定事項#7)', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const path50 = join(samplesDir, '19_10_01_150916_VPHW50.xml');
    const path51 = join(samplesDir, '19_10_02_150916_VPHW51.xml');
    assert.ok(existsSync(path50) && existsSync(path51));

    const xml50 = readFileSync(path50, 'utf-8');
    const xml51 = readFileSync(path51, 'utf-8');

    const saitamaTarget: BosaiBulletinTarget = {
      includedAreaCodes: ['110000', '110010'],
    };

    const rec50 = createSampleReception(context, {
      rawBody: xml50,
      telegramType: 'VPHW50',
      documentUrl: 'https://example.com/19_10_01_150916_VPHW50.xml',
      controlDateTime: '2015-07-17T00:21:00.000Z',
      reportDateTime: '2015-07-17T00:21:00.000Z',
    });

    const rec51 = createSampleReception(context, {
      rawBody: xml51,
      telegramType: 'VPHW51',
      documentUrl: 'https://example.com/19_10_02_150916_VPHW51.xml',
      controlDateTime: '2015-07-17T00:21:00.000Z',
      reportDateTime: '2015-07-17T00:21:00.000Z',
    });

    processVphwReception(context.connection, rec50, '2015-07-17T00:40:00.000Z', saitamaTarget);
    processVphwReception(context.connection, rec51, '2015-07-17T00:40:00.000Z', saitamaTarget);

    const b50 = findBosaiBulletin(context.connection, 'VPHW50:110000', 'normal');
    const b51 = findBosaiBulletin(context.connection, 'VPHW51:110000', 'normal');

    assert.ok(b50, 'VPHW50:110000 が存在すること');
    assert.ok(b51, 'VPHW51:110000 が存在すること');
    assert.equal(b50.hasSighting, null);
    assert.equal(b51.hasSighting, true);

    const all = listBosaiBulletins(context.connection, { controlStatus: 'normal' });
    assert.equal(all.length, 2, 'VPHW50 と VPHW51 の2行が並存していること');
  } finally {
    cleanup();
  }
});

test('受け入れ条件 (processor・取消): InfoType=取消 で is_cancelled=1 に更新され、欠落要素が NULL で保存される (引き継ぎなし)', () => {
  const { context, cleanup } = setupTestDb();
  try {
    // 1. 発表電文の保存
    // 公式サンプル 19_01_01 を加工した合成データ
    const xmlInitial = buildVphwXml({
      telegramType: 'VPHW50',
      controlDateTime: '2009-08-09T22:38:36Z',
      headlineText: '初期本文',
      validDateTime: '2009-08-10T08:40:00+09:00',
    });
    const recInitial = createSampleReception(context, {
      rawBody: xmlInitial,
      controlDateTime: '2009-08-09T22:38:36.000Z',
    });
    processVphwReception(context.connection, recInitial, '2009-08-09T22:40:00.000Z');

    const bBefore = findBosaiBulletin(context.connection, 'VPHW50:130010', 'normal');
    assert.ok(bBefore);
    assert.equal(bBefore.headlineText, '初期本文');
    assert.equal(bBefore.isCancelled, false);
    assert.equal(bBefore.metadata.validAt, '2009-08-09T23:40:00.000Z');

    // 2. 取消電文 (Text 欠落、ValidDateTime 欠落)
    // 公式サンプル 19_01_01 を加工した合成データ (実挙動未確認)
    const xmlCancel = buildVphwXml({
      telegramType: 'VPHW50',
      controlDateTime: '2009-08-09T22:50:00Z',
      infoType: '取消',
      headTitle: '東京都竜巻注意情報（取消）',
      omitHeadlineText: true,
      omitValidDateTime: true,
    });
    const recCancel = createSampleReception(context, {
      rawBody: xmlCancel,
      controlDateTime: '2009-08-09T22:50:00.000Z',
    });
    processVphwReception(context.connection, recCancel, '2009-08-09T22:51:00.000Z');

    // 行が削除されず更新されていること
    const bAfter = findBosaiBulletin(context.connection, 'VPHW50:130010', 'normal');
    assert.ok(bAfter);
    assert.equal(bAfter.infoType, '取消');
    assert.equal(bAfter.isCancelled, true);
    assert.equal(bAfter.headlineText, null, '初期本文が引き継がれず NULL になること');
    assert.equal(bAfter.metadata.validAt, null, '初期有効期限が引き継がれず NULL になること');
    assert.equal(bAfter.metadata.validTo, null);
    assert.notEqual(
      bAfter.headlineText,
      '東京都竜巻注意情報（取消）',
      'Head/Title が代入されていないこと',
    );
  } finally {
    cleanup();
  }
});

test('受け入れ条件 (processor・取消): 取消で発表細分欠落時は代替キーになり既存行を変更しない', () => {
  const { context, cleanup } = setupTestDb();
  try {
    // 1. 発表電文の保存
    const xmlInitial = buildVphwXml({
      telegramType: 'VPHW50',
      controlDateTime: '2009-08-09T22:38:36Z',
      headlineText: '初期本文',
    });
    const recInitial = createSampleReception(context, {
      rawBody: xmlInitial,
      controlDateTime: '2009-08-09T22:38:36.000Z',
    });
    processVphwReception(context.connection, recInitial, '2009-08-09T22:40:00.000Z');

    // 2. 発表細分欠落の取消電文
    const xmlCancelNoSaibun = buildVphwXml({
      telegramType: 'VPHW50',
      controlDateTime: '2009-08-09T22:50:00Z',
      infoType: '取消',
      omitHeadlineText: true,
      omitValidDateTime: true,
      omitSaibunInfo: true,
    });
    const recCancel = createSampleReception(context, {
      rawBody: xmlCancelNoSaibun,
      controlDateTime: '2009-08-09T22:50:00.000Z',
    });
    processVphwReception(context.connection, recCancel, '2009-08-09T22:51:00.000Z');

    // 既存の VPHW50:130010 行が変更されていないこと
    const bInitial = findBosaiBulletin(context.connection, 'VPHW50:130010', 'normal');
    assert.ok(bInitial);
    assert.equal(bInitial.headlineText, '初期本文');
    assert.equal(bInitial.isCancelled, false);

    // 代替キーの取消行が保存されていること
    const bCancel = findBosaiBulletin(
      context.connection,
      'VPHW50:cancel:2009-08-09T22:50:00.000Z',
      'normal',
    );
    assert.ok(bCancel);
    assert.equal(bCancel.isCancelled, true);
    assert.equal(bCancel.informationTag, null);
  } finally {
    cleanup();
  }
});

test('受け入れ条件 (processor・訓練試験分離): Control/Status が 訓練 / 試験 の場合は normal 行を上書きせず別行となる', () => {
  const { context, cleanup } = setupTestDb();
  try {
    // 1. 通常電文の投入
    // 公式サンプル 19_01_01 を加工した合成データ
    const xmlNormal = buildVphwXml({
      controlStatus: '通常',
      headlineText: '通常本文',
    });
    const recNormal = createSampleReception(context, {
      rawBody: xmlNormal,
      controlStatus: 'normal',
    });
    processVphwReception(context.connection, recNormal, '2009-08-09T22:40:00.000Z');

    // 2. 訓練電文の投入
    const xmlTraining = buildVphwXml({
      controlStatus: '訓練',
      headlineText: '訓練本文',
    });
    const recTraining = createSampleReception(context, {
      rawBody: xmlTraining,
      controlStatus: 'training',
    });
    processVphwReception(context.connection, recTraining, '2009-08-09T22:41:00.000Z');

    // 3. 試験電文の投入
    const xmlTest = buildVphwXml({
      controlStatus: '試験',
      headlineText: '試験本文',
    });
    const recTest = createSampleReception(context, {
      rawBody: xmlTest,
      controlStatus: 'test',
    });
    processVphwReception(context.connection, recTest, '2009-08-09T22:42:00.000Z');

    // 3行が独立して存在し、normal が書き換わっていないこと
    const bNormal = findBosaiBulletin(context.connection, 'VPHW50:130010', 'normal');
    assert.ok(bNormal);
    assert.equal(bNormal.headlineText, '通常本文');
    assert.equal(bNormal.controlStatus, 'normal');

    const bTraining = findBosaiBulletin(context.connection, 'VPHW50:130010', 'training');
    assert.ok(bTraining);
    assert.equal(bTraining.headlineText, '訓練本文');
    assert.equal(bTraining.controlStatus, 'training');

    const bTest = findBosaiBulletin(context.connection, 'VPHW50:130010', 'test');
    assert.ok(bTest);
    assert.equal(bTest.headlineText, '試験本文');
    assert.equal(bTest.controlStatus, 'test');

    // listBosaiBulletins の絞り込みで訓練行のみが返ること
    const eastTargets = resolveVenueForecastTargets('east').bosaiBulletin.includedAreaCodes;
    const trainingList = listBosaiBulletins(context.connection, {
      controlStatus: 'training',
      includedAreaCodes: eastTargets,
    });
    assert.equal(trainingList.length, 1);
    assert.equal(trainingList[0]!.controlStatus, 'training');

    const normalList = listBosaiBulletins(context.connection, {
      controlStatus: 'normal',
      includedAreaCodes: eastTargets,
    });
    assert.equal(normalList.length, 1);
    assert.equal(normalList[0]!.controlStatus, 'normal');
  } finally {
    cleanup();
  }
});

test('受け入れ条件 (processor・原子性): saveBosaiBulletin 失敗時に adoption も更新されない', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const rawXml = buildVphwXml();
    const reception = createSampleReception(context, { rawBody: rawXml });

    context.connection.exec(`
      CREATE TRIGGER fail_bulletin_insert
      BEFORE INSERT ON bosai_bulletin
      BEGIN
        SELECT RAISE(FAIL, 'DB insert failure simulation');
      END;
    `);

    assert.throws(
      () => processVphwReception(context.connection, reception, '2009-08-09T22:40:00.000Z'),
      /DB insert failure simulation/,
    );

    const rec = findTelegramReceptionById(context.connection, reception.id);
    assert.ok(rec);
    assert.equal(rec.adoptionResult, null);
    assert.equal(rec.adoptionDecidedAt, null);
  } finally {
    cleanup();
  }
});

test('受け入れ条件 (processor・原文なし): rawBody=null の場合は未対応構造として adoption が更新される', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const reception = createSampleReception(context, { rawBody: '' });
    context.connection
      .prepare('UPDATE telegram_reception SET raw_body = NULL WHERE id = ?')
      .run(reception.id);
    const nullBodyReception = findTelegramReceptionById(context.connection, reception.id)!;

    const result = processVphwReception(
      context.connection,
      nullBodyReception,
      '2009-08-09T22:40:00.000Z',
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

test('受け入れ条件 (processor・対象判定): 19_01_01_091210_VPHW50.xml は east/trc 両方の絞り込みで返る', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const samplePath = join(samplesDir, '19_01_01_091210_VPHW50.xml');
    assert.ok(existsSync(samplePath));
    const xml = readFileSync(samplePath, 'utf-8');

    const reception = createSampleReception(context, {
      rawBody: xml,
      telegramType: 'VPHW50',
      controlDateTime: '2009-08-09T22:38:00.000Z',
      reportDateTime: '2009-08-09T22:38:00.000Z',
    });

    processVphwReception(context.connection, reception, '2009-08-09T22:40:00.000Z');

    const eastTargets = resolveVenueForecastTargets('east').bosaiBulletin.includedAreaCodes;
    const eastList = listBosaiBulletins(context.connection, {
      controlStatus: 'normal',
      includedAreaCodes: eastTargets,
    });
    assert.equal(eastList.length, 1);

    const trcTargets = resolveVenueForecastTargets('trc').bosaiBulletin.includedAreaCodes;
    const trcList = listBosaiBulletins(context.connection, {
      controlStatus: 'normal',
      includedAreaCodes: trcTargets,
    });
    assert.equal(trcList.length, 1);
  } finally {
    cleanup();
  }
});
