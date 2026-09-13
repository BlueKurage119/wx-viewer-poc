import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initializeDatabase } from '../src/database/index.js';
import { startServer } from '../src/server.js';
import {
  planBosaiBulletinNotifications,
  resolveBosaiBulletinSourceVersion,
  resolveBosaiBulletinExpiresAt,
} from '../src/notifications/bosaiBulletinNotificationPlanner.js';
import {
  InitialBosaiNotificationTracker,
  emitInitialBosaiBulletinNotifications,
  type BosaiNotificationEmitDeps,
} from '../src/notifications/bosaiBulletinNotificationEmitter.js';
import { projectStartupCurrentNotifications } from '../src/notifications/startupCurrentNotificationProjector.js';
import {
  createStartupNotificationService,
  StartupNotificationInitialization,
} from '../src/notifications/startupNotificationService.js';
import { processVpbs50Reception } from '../src/polling/jmaVpbs50Processor.js';
import {
  processVphwReception,
  recoverLegacyVphwBulletinAreas,
} from '../src/polling/jmaVphwProcessor.js';
import { parseVphw } from '../src/polling/jmaVphwParser.js';
import {
  findBosaiBulletin,
  saveBosaiBulletin,
} from '../src/repositories/bosaiBulletinRepository.js';
import { listNotificationOutputHistory } from '../src/repositories/notificationOutputHistoryRepository.js';
import { recordTelegramReception } from '../src/repositories/telegramReceptionRepository.js';
import type {
  BosaiBulletin,
  ControlStatus,
  FetchHealthAggregate,
  TelegramReception,
  VphwTelegramType,
} from '../src/repositories/types.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const migrationsDirectory = join(apiRoot, 'migrations');
const jmaFixturesDir = join(apiRoot, 'tests/fixtures/jma');

function setupTestDb() {
  const directory = mkdtempSync(join(tmpdir(), 'wx-viewer-poc-issue145-test-'));
  const databasePath = join(directory, 'test.sqlite3');
  const context = initializeDatabase({
    databasePath,
    migrationsDirectory,
  });

  return {
    context,
    databasePath,
    cleanup: () => {
      context.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function createNormalEmitDeps(fixedNowIso: string): {
  deps: BosaiNotificationEmitDeps;
  tracker: InitialBosaiNotificationTracker;
} {
  const tracker = new InitialBosaiNotificationTracker();
  tracker.setCollecting(false);
  tracker.markCompleted('east', 'normal');
  tracker.markCompleted('trc', 'normal');
  tracker.markCompleted('east', 'training');
  tracker.markCompleted('trc', 'training');

  const deps: BosaiNotificationEmitDeps = {
    now: () => fixedNowIso,
    initialState: tracker,
  };

  return { deps, tracker };
}

interface BuildVpbs50Options {
  controlTitle?: string;
  controlStatus?: string;
  controlDateTime?: string;
  headTitle?: string;
  reportDateTime?: string;
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

function buildVpbs50Xml(options: BuildVpbs50Options = {}): string {
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
        (a) => `
          <MeteorologicalInfo>
            <Item>
              <Area codeType="${a.codeType ?? '気象・地震・火山情報／市町村等'}"><Name>${a.name}</Name><Code>${a.code}</Code></Area>
            </Item>
          </MeteorologicalInfo>
        `,
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
    <TargetDateTime>${reportDateTime}</TargetDateTime>
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

interface BuildVphwOptions {
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
  saibunAreaCode?: string;
  saibunAreaName?: string;
  includeSightingInfo?: boolean;
  sightingAreas?: Array<{ name: string; code: string; codeType?: string }>;
  shichosonAreas?: Array<{ name: string; code: string; codeType?: string }>;
}

function buildVphwXml(options: BuildVphwOptions = {}): string {
  const tType = options.telegramType ?? 'VPHW50';
  const controlTitle =
    options.controlTitle ?? (tType === 'VPHW50' ? '竜巻注意情報' : '竜巻注意情報（目撃情報付き）');
  const controlStatus = options.controlStatus ?? '通常';
  const controlDateTime = options.controlDateTime ?? '2026-09-10T07:48:12Z';
  const headTitle = options.headTitle ?? '東京都竜巻注意情報';
  const reportDateTime = options.reportDateTime ?? '2026-09-10T16:48:00+09:00';
  const eventId = options.eventId ?? '';
  const infoType = options.infoType ?? '発表';
  const infoKind = options.infoKind ?? '竜巻注意情報';
  const infoKindVersion = options.infoKindVersion ?? (tType === 'VPHW50' ? '1.0_0' : '1.1_0');

  let validDtXml = '';
  if (!options.omitValidDateTime) {
    const vVal = options.validDateTime ?? '2026-09-10T17:50:00+09:00';
    validDtXml = `<ValidDateTime>${vVal}</ValidDateTime>`;
  }

  let textXml = '';
  if (!options.omitHeadlineText) {
    const textContent =
      options.headlineText ??
      '東京地方は、竜巻などの激しい突風が発生しやすい気象状況になっています。';
    textXml = `<Text>${textContent}</Text>`;
  }

  const saibunCode = options.saibunAreaCode ?? '130010';
  const saibunName = options.saibunAreaName ?? '東京地方';

  const saibunXml = `
    <Information type="竜巻注意情報（発表細分）">
      <Item>
        <Kind><Name>竜巻注意情報</Name><Code>01</Code><Condition>発表</Condition></Kind>
        <Areas codeType="気象情報／府県予報区・細分区域等">
          <Area><Name>${saibunName}</Name><Code>${saibunCode}</Code></Area>
        </Areas>
      </Item>
    </Information>
  `;

  const primarySaibunXml = `
    <Information type="竜巻注意情報（一次細分区域等）">
      <Item>
        <Kind><Name>竜巻注意情報</Name><Code>01</Code><Condition>発表</Condition></Kind>
        <Areas codeType="気象情報／府県予報区・細分区域等">
          <Area><Name>${saibunName}</Name><Code>${saibunCode}</Code></Area>
        </Areas>
      </Item>
    </Information>
  `;

  const summaryXml = `
    <Information type="竜巻注意情報（市町村等をまとめた地域等）">
      <Item>
        <Kind><Name>竜巻注意情報</Name><Code>01</Code><Condition>発表</Condition></Kind>
        <Areas codeType="気象情報／府県予報区・細分区域等">
          <Area><Name>${saibunName}</Name><Code>${saibunCode}</Code></Area>
        </Areas>
      </Item>
    </Information>
  `;

  const shichosonAreas = options.shichosonAreas ?? [
    { name: '江東区', code: '1310800', codeType: '気象・地震・火山情報／市町村等' },
    { name: '大田区', code: '1311100', codeType: '気象・地震・火山情報／市町村等' },
  ];

  const shichosonItems = shichosonAreas
    .map(
      (a) => `
      <Item>
        <Kind><Name>竜巻注意情報</Name><Code>01</Code><Condition>発表</Condition></Kind>
        <Areas codeType="${a.codeType ?? '気象・地震・火山情報／市町村等'}">
          <Area><Name>${a.name}</Name><Code>${a.code}</Code></Area>
        </Areas>
      </Item>
    `,
    )
    .join('');

  const shichosonXml = `
    <Information type="竜巻注意情報（市町村等）">
      ${shichosonItems}
    </Information>
  `;

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
      ${primarySaibunXml}
      ${summaryXml}
      ${shichosonXml}
      ${sightingXml}
    </Headline>
  </Head>
  <Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/">
  </Body>
</Report>`;
}

function saveTestReception(
  connection: ReturnType<typeof initializeDatabase>['connection'],
  telegramType: string,
  controlDateTime: string,
  reportDateTime: string,
  controlStatus: ControlStatus = 'normal',
  rawBody: string = '',
): TelegramReception {
  const normControlDateTime = new Date(controlDateTime).toISOString();
  const normReportDateTime = new Date(reportDateTime).toISOString();
  return recordTelegramReception(connection, {
    fetchAttemptId: null,
    feedKind: 'test',
    feedEntryId: `entry-${Date.now()}-${Math.random()}`,
    documentUrl: `http://example.com/test-${Date.now()}-${Math.random()}.xml`,
    telegramType,
    title: 'テスト速報',
    controlStatus,
    infoType: '発表',
    eventId: null,
    serial: null,
    controlDateTime: normControlDateTime,
    reportDateTime: normReportDateTime,
    targetDateTime: null,
    receivedAt: normControlDateTime,
    rawBody,
    bodyBytes: Buffer.byteLength(rawBody, 'utf-8'),
    contentHash: 'hash-' + Math.random(),
    areas: [],
    adoptions: [],
  });
}

// -----------------------------------------------------------------------------
// AC1: 発生・直前・記録雨の通常通知と除外条件の検証
// -----------------------------------------------------------------------------
test('AC1: 既存VPBS50の発生・直前・記録雨fixtureを会場に該当する条件で通常processorへ投入し、各該当会場・種別につき1件、既存定義ID・question・ackRequired=trueのB4履歴を確認。非該当会場・短時間大雪・未知タグは0件。', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const fixedNowIso = '2026-09-10T08:00:00.000Z';
    const { deps: emitDeps } = createNormalEmitDeps(fixedNowIso);

    // 1. 線状降水帯発生 (東京地方 130010: east, trc 両方に該当)
    const xmlBand = buildVpbs50Xml({
      condition: '線状降水帯発生',
      reportDateTime: '2026-09-10T07:30:00Z',
      controlDateTime: '2026-09-10T07:30:00Z',
      headlineAreas: [
        { name: '東京地方', code: '130010', codeType: '気象情報／府県予報区・細分区域等' },
      ],
    });
    const receptionBand = saveTestReception(
      context.connection,
      'VPBS50',
      '2026-09-10T07:30:00Z',
      '2026-09-10T07:30:00Z',
      'normal',
      xmlBand,
    );

    processVpbs50Reception(context.connection, receptionBand, fixedNowIso, undefined, emitDeps);

    // east, trc 両会場で各1件、計2件
    const outputs1 = listNotificationOutputHistory(context.connection, { category: 'question' });
    assert.equal(outputs1.length, 2);
    for (const out of outputs1) {
      assert.equal(out.messageDefinitionId, 'weather-bosai-bulletin-linear-rainband-observed');
      assert.equal(out.category, 'question');
      assert.equal(out.ackRequired, true);
      assert.equal(out.origin, 'weather');
      assert.equal(out.detectionContext, 'normal');
      assert.equal(out.changeType, 'new');
    }

    // 2. 線状降水帯直前 (江東区 1310800: east のみ該当)
    const xmlForecast = buildVpbs50Xml({
      eventId: 'JPTE202609100002_202609100002',
      condition: '線状降水帯直前',
      reportDateTime: '2026-09-10T07:40:00Z',
      controlDateTime: '2026-09-10T07:40:00Z',
      headlineAreas: [
        { name: '江東区', code: '1310800', codeType: '気象・地震・火山情報／市町村等' },
      ],
    });
    const receptionForecast = saveTestReception(
      context.connection,
      'VPBS50',
      '2026-09-10T07:40:00Z',
      '2026-09-10T07:40:00Z',
      'normal',
      xmlForecast,
    );

    processVpbs50Reception(context.connection, receptionForecast, fixedNowIso, undefined, emitDeps);

    const outputs2 = listNotificationOutputHistory(context.connection, { category: 'question' });
    assert.equal(outputs2.length, 3); // 2 + 1 (east のみ)
    const forecastOutput = outputs2.find(
      (o) => o.messageDefinitionId === 'weather-bosai-bulletin-linear-rainband-forecast',
    );
    assert.ok(forecastOutput);
    const targetArea = JSON.parse(forecastOutput.targetAreaJson!)[0];
    assert.equal(targetArea.code, 'east');

    // 3. 記録的短時間大雨 (大田区 1311100: trc のみ該当)
    const xmlRecord = buildVpbs50Xml({
      eventId: 'JPTE202609100003_202609100003',
      condition: '記録雨',
      reportDateTime: '2026-09-10T07:50:00Z',
      controlDateTime: '2026-09-10T07:50:00Z',
      headlineAreas: [
        { name: '大田区', code: '1311100', codeType: '気象・地震・火山情報／市町村等' },
      ],
    });
    const receptionRecord = saveTestReception(
      context.connection,
      'VPBS50',
      '2026-09-10T07:50:00Z',
      '2026-09-10T07:50:00Z',
      'normal',
      xmlRecord,
    );

    processVpbs50Reception(context.connection, receptionRecord, fixedNowIso, undefined, emitDeps);

    const outputs3 = listNotificationOutputHistory(context.connection, { category: 'question' });
    assert.equal(outputs3.length, 4); // 3 + 1 (trc のみ)
    const recordOutput = outputs3.find(
      (o) => o.messageDefinitionId === 'weather-bosai-bulletin-record-short-rain',
    );
    assert.ok(recordOutput);
    const recordTargetArea = JSON.parse(recordOutput.targetAreaJson!)[0];
    assert.equal(recordTargetArea.code, 'trc');

    // 4. 非該当会場 (網走 013010) -> 0 件
    const xmlAbashiri = buildVpbs50Xml({
      eventId: 'JPTE202609100004_202609100004',
      condition: '線状降水帯発生',
      reportDateTime: '2026-09-10T07:55:00Z',
      controlDateTime: '2026-09-10T07:55:00Z',
      headlineAreas: [
        { name: '網走地方', code: '013010', codeType: '気象情報／府県予報区・細分区域等' },
      ],
    });
    const receptionAbashiri = saveTestReception(
      context.connection,
      'VPBS50',
      '2026-09-10T07:55:00Z',
      '2026-09-10T07:55:00Z',
      'normal',
      xmlAbashiri,
    );
    processVpbs50Reception(context.connection, receptionAbashiri, fixedNowIso, undefined, emitDeps);
    assert.equal(
      listNotificationOutputHistory(context.connection, { category: 'question' }).length,
      4,
    );

    // 5. 短時間大雪 (対象外種別) -> 0 件
    const xmlSnow = buildVpbs50Xml({
      eventId: 'JPTE202609100005_202609100005',
      condition: '短時間大雪',
      reportDateTime: '2026-09-10T07:56:00Z',
      controlDateTime: '2026-09-10T07:56:00Z',
      headlineAreas: [
        { name: '江東区', code: '1310800', codeType: '気象・地震・火山情報／市町村等' },
      ],
    });
    const receptionSnow = saveTestReception(
      context.connection,
      'VPBS50',
      '2026-09-10T07:56:00Z',
      '2026-09-10T07:56:00Z',
      'normal',
      xmlSnow,
    );
    processVpbs50Reception(context.connection, receptionSnow, fixedNowIso, undefined, emitDeps);
    assert.equal(
      listNotificationOutputHistory(context.connection, { category: 'question' }).length,
      4,
    );
  } finally {
    cleanup();
  }
});

// -----------------------------------------------------------------------------
// AC2: 同版再取得抑止・旧版抑止・訂正通知検証
// -----------------------------------------------------------------------------
test('AC2: 同じ電文の再処理・同Control/DateTimeの再取得・古い版の投入で履歴0件増加。ReportDateTimeを維持しControl/DateTimeを進めた訂正fixtureで1件増加し、訂正定義・corrected・異なるsourceVersionを確認。', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const fixedNowIso = '2026-09-10T08:00:00.000Z';
    const { deps: emitDeps } = createNormalEmitDeps(fixedNowIso);

    const xmlBase = buildVpbs50Xml({
      eventId: 'JPTE202609100001_202609100001',
      condition: '線状降水帯発生',
      reportDateTime: '2026-09-10T07:00:00Z',
      controlDateTime: '2026-09-10T07:00:00Z',
      headlineAreas: [
        { name: '江東区', code: '1310800', codeType: '気象・地震・火山情報／市町村等' },
      ],
    });
    const receptionBase = saveTestReception(
      context.connection,
      'VPBS50',
      '2026-09-10T07:00:00Z',
      '2026-09-10T07:00:00Z',
      'normal',
      xmlBase,
    );

    // 1回目投入 -> 1件通知 (east)
    processVpbs50Reception(context.connection, receptionBase, fixedNowIso, undefined, emitDeps);
    assert.equal(listNotificationOutputHistory(context.connection).length, 1);
    const firstOutput = listNotificationOutputHistory(context.connection)[0]!;

    // 同じ電文の再処理 -> 0件増加
    processVpbs50Reception(context.connection, receptionBase, fixedNowIso, undefined, emitDeps);
    assert.equal(listNotificationOutputHistory(context.connection).length, 1);

    // 同 Control/DateTime の別 reception -> 0件増加 (processor が同版スキップ)
    const receptionSame = saveTestReception(
      context.connection,
      'VPBS50',
      '2026-09-10T07:00:00Z',
      '2026-09-10T07:00:00Z',
      'normal',
      xmlBase,
    );
    processVpbs50Reception(context.connection, receptionSame, fixedNowIso, undefined, emitDeps);
    assert.equal(listNotificationOutputHistory(context.connection).length, 1);

    // 古い版 (Control/DateTime が過去) -> 0件増加
    const xmlOld = buildVpbs50Xml({
      eventId: 'JPTE202609100001_202609100001',
      condition: '線状降水帯発生',
      reportDateTime: '2026-09-10T07:00:00Z',
      controlDateTime: '2026-09-10T06:50:00Z',
      headlineAreas: [
        { name: '江東区', code: '1310800', codeType: '気象・地震・火山情報／市町村等' },
      ],
    });
    const receptionOld = saveTestReception(
      context.connection,
      'VPBS50',
      '2026-09-10T06:50:00Z',
      '2026-09-10T07:00:00Z',
      'normal',
      xmlOld,
    );
    processVpbs50Reception(context.connection, receptionOld, fixedNowIso, undefined, emitDeps);
    assert.equal(listNotificationOutputHistory(context.connection).length, 1);

    // 訂正電文: ReportDateTime 維持、Control/DateTime 進行、infoType='訂正'
    const xmlCorrected = buildVpbs50Xml({
      eventId: 'JPTE202609100001_202609100001',
      infoType: '訂正',
      condition: '線状降水帯発生',
      reportDateTime: '2026-09-10T07:00:00Z',
      controlDateTime: '2026-09-10T07:10:00Z',
      headlineAreas: [
        { name: '江東区', code: '1310800', codeType: '気象・地震・火山情報／市町村等' },
      ],
    });
    const receptionCorrected = saveTestReception(
      context.connection,
      'VPBS50',
      '2026-09-10T07:10:00Z',
      '2026-09-10T07:00:00Z',
      'normal',
      xmlCorrected,
    );

    processVpbs50Reception(
      context.connection,
      receptionCorrected,
      fixedNowIso,
      undefined,
      emitDeps,
    );

    const outputs = listNotificationOutputHistory(context.connection);
    assert.equal(outputs.length, 2);

    const corrOutput = outputs.find((o) => o.changeType === 'corrected');
    assert.ok(corrOutput);
    assert.equal(corrOutput.messageDefinitionId, 'weather-bosai-bulletin-corrected');
    assert.equal(corrOutput.category, 'question');
    assert.equal(corrOutput.ackRequired, true);
    assert.notEqual(corrOutput.sourceVersion, firstOutput.sourceVersion);
  } finally {
    cleanup();
  }
});

// -----------------------------------------------------------------------------
// AC3: 取消通知検証および見送り理由追跡
// -----------------------------------------------------------------------------
test('AC3: 対象特定可能なVPBS50取消fixtureを投入し、該当会場のみ取消定義・warning・確認不要で記録。取消現況を起動APIが返さない。対象不明取消・VPHW取消は通常通知0件、理由が追跡可能であること。§8-3承認後は種別/区域の不一致を注入して見送り理由を検証する。', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const fixedNowIso = '2026-09-10T08:00:00.000Z';
    const { deps: emitDeps } = createNormalEmitDeps(fixedNowIso);

    // まず発表電文を投入 (江東区 1310800: east)
    const xmlBase = buildVpbs50Xml({
      eventId: 'JPTE202609100001_202609100001',
      condition: '線状降水帯発生',
      reportDateTime: '2026-09-10T07:00:00Z',
      controlDateTime: '2026-09-10T07:00:00Z',
      headlineAreas: [
        { name: '江東区', code: '1310800', codeType: '気象・地震・火山情報／市町村等' },
      ],
    });
    const receptionBase = saveTestReception(
      context.connection,
      'VPBS50',
      '2026-09-10T07:00:00Z',
      '2026-09-10T07:00:00Z',
      'normal',
      xmlBase,
    );
    processVpbs50Reception(context.connection, receptionBase, fixedNowIso, undefined, emitDeps);
    assert.equal(listNotificationOutputHistory(context.connection).length, 1);

    // 1. 対象特定可能な VPBS50 取消 (Body に江東区 1310800 あり)
    const xmlCancel = buildVpbs50Xml({
      eventId: 'JPTE202609100001_202609100001',
      infoType: '取消',
      omitHeadlineText: true,
      omitInformationTag: true,
      controlDateTime: '2026-09-10T07:15:00Z',
      reportDateTime: '2026-09-10T07:15:00Z',
      bodyAreas: [{ name: '江東区', code: '1310800', codeType: '気象・地震・火山情報／市町村等' }],
    });
    const receptionCancel = saveTestReception(
      context.connection,
      'VPBS50',
      '2026-09-10T07:15:00Z',
      '2026-09-10T07:15:00Z',
      'normal',
      xmlCancel,
    );

    processVpbs50Reception(context.connection, receptionCancel, fixedNowIso, undefined, emitDeps);

    const outputs = listNotificationOutputHistory(context.connection);
    assert.equal(outputs.length, 2);
    const cancelOutput = outputs.find((o) => o.changeType === 'cancelled');
    assert.ok(cancelOutput);
    assert.equal(cancelOutput.messageDefinitionId, 'weather-bosai-bulletin-cancelled');
    assert.equal(cancelOutput.category, 'warning');
    assert.equal(cancelOutput.ackRequired, false);

    // 取消現況は起動 API で返されない
    const startupNotifications = projectStartupCurrentNotifications(context.connection, {
      venueId: 'east',
      now: fixedNowIso,
      includeWarningCategory: true,
      fetchHealth: null,
    });
    assert.equal(startupNotifications.notifications.length, 0);

    // 2. VPHW 取消電文は通常通知 0 件 (設計書 §4.2: VPHW の取消は通常通知・起動現況ともに計画対象外)
    const xmlVphwCancel = buildVphwXml({
      eventId: '',
      infoType: '取消',
      omitHeadlineText: true,
      omitValidDateTime: true,
      controlDateTime: '2026-09-10T07:20:00Z',
      reportDateTime: '2026-09-10T07:20:00Z',
    });
    const receptionVphwCancel = saveTestReception(
      context.connection,
      'VPHW50',
      '2026-09-10T07:20:00Z',
      '2026-09-10T07:20:00Z',
      'normal',
      xmlVphwCancel,
    );
    processVphwReception(context.connection, receptionVphwCancel, fixedNowIso, undefined, emitDeps);
    assert.equal(listNotificationOutputHistory(context.connection).length, 2); // 増えない

    // 3. 対象不明取消および食い違い取消 (§8-3) を processor 経由で投入し、受信ID・EventID・会場・理由のログ追跡性を検証
    const warnLogs: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnLogs.push(args.map(String).join(' '));
      origWarn(...args);
    };

    try {
      // 3-1. 未知イベントの取消電文 (previousなし、種別なし、Body区域のみ)
      const xmlUnknownCancel = buildVpbs50Xml({
        eventId: 'JPTE202609109999_202609109999',
        infoType: '取消',
        omitHeadlineText: true,
        omitInformationTag: true,
        controlDateTime: '2026-09-10T07:30:00Z',
        reportDateTime: '2026-09-10T07:30:00Z',
        bodyAreas: [
          { name: '江東区', code: '1310800', codeType: '気象・地震・火山情報／市町村等' },
        ],
      });
      const receptionUnknownCancel = saveTestReception(
        context.connection,
        'VPBS50',
        '2026-09-10T07:30:00Z',
        '2026-09-10T07:30:00Z',
        'normal',
        xmlUnknownCancel,
      );
      processVpbs50Reception(
        context.connection,
        receptionUnknownCancel,
        fixedNowIso,
        undefined,
        emitDeps,
      );

      // 受信ID, EventID, 会場, reason をログで確認
      const unknownLog = warnLogs.find(
        (log) =>
          log.includes(`receptionId=${receptionUnknownCancel.id}`) &&
          log.includes('eventId=JPTE202609109999_202609109999') &&
          log.includes('venueId=east') &&
          log.includes('[unknown_cancellation_target]'),
      );
      assert.ok(
        unknownLog,
        'unknown_cancellation_targetのログに受信ID・EventID・会場・理由が含まれていること',
      );

      // 3-2. 食い違い取消電文 (previousは線状降水帯発生、取消電文は記録雨)
      warnLogs.length = 0;
      // 事前に発表電文を投入
      const xmlAmbiguousBase = buildVpbs50Xml({
        eventId: 'JPTE202609100003_202609100003',
        condition: '線状降水帯発生',
        controlDateTime: '2026-09-10T07:35:00Z',
        reportDateTime: '2026-09-10T07:35:00Z',
        headlineAreas: [
          { name: '江東区', code: '1310800', codeType: '気象・地震・火山情報／市町村等' },
        ],
      });
      const receptionAmbiguousBase = saveTestReception(
        context.connection,
        'VPBS50',
        '2026-09-10T07:35:00Z',
        '2026-09-10T07:35:00Z',
        'normal',
        xmlAmbiguousBase,
      );
      processVpbs50Reception(
        context.connection,
        receptionAmbiguousBase,
        fixedNowIso,
        undefined,
        emitDeps,
      );

      warnLogs.length = 0;
      const xmlAmbiguousCancel = buildVpbs50Xml({
        eventId: 'JPTE202609100003_202609100003',
        infoType: '取消',
        condition: '記録雨',
        controlDateTime: '2026-09-10T07:40:00Z',
        reportDateTime: '2026-09-10T07:40:00Z',
        headlineAreas: [
          { name: '江東区', code: '1310800', codeType: '気象・地震・火山情報／市町村等' },
        ],
      });
      const receptionAmbiguousCancel = saveTestReception(
        context.connection,
        'VPBS50',
        '2026-09-10T07:40:00Z',
        '2026-09-10T07:40:00Z',
        'normal',
        xmlAmbiguousCancel,
      );
      processVpbs50Reception(
        context.connection,
        receptionAmbiguousCancel,
        fixedNowIso,
        undefined,
        emitDeps,
      );

      const ambiguousLog = warnLogs.find(
        (log) =>
          log.includes(`receptionId=${receptionAmbiguousCancel.id}`) &&
          log.includes('eventId=JPTE202609100003_202609100003') &&
          log.includes('venueId=east') &&
          log.includes('[ambiguous_cancellation_target]'),
      );
      assert.ok(
        ambiguousLog,
        'ambiguous_cancellation_targetのログに受信ID・EventID・会場・理由が含まれていること',
      );
    } finally {
      console.warn = origWarn;
    }
  } finally {
    cleanup();
  }
});

// -----------------------------------------------------------------------------
// AC4: 初期取得通知と tracker 冪等性・再起動検証
// -----------------------------------------------------------------------------
test('AC4: 初期取得に同一速報の複数版を投入して完了させ、最新の期限内現況だけが会場別にinitial履歴へ1回記録される。初期取得failedでは未評価、failed→completedで1回評価。同一runtimeで初期評価を再実行して増えない。再起動runtimeでは期限内現況がinitialになる。', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const fixedNowIso = '2026-09-10T08:00:00.000Z';

    // 初期取得で同一速報の複数版（版1、版2）を保存
    // 版1: 06:00
    saveBosaiBulletin(context.connection, {
      eventId: 'JPTE202609100001_202609100001',
      controlStatus: 'normal',
      infoType: '発表',
      reportDateTime: '2026-09-10T06:00:00Z',
      controlDateTime: '2026-09-10T06:00:00Z',
      title: '東京都気象防災速報（線状降水帯発生）',
      headlineText: '本文1',
      informationTag: '線状降水帯発生',
      hasSighting: null,
      isCancelled: false,
      metadata: {
        source: 'test',
        issuedAt: '2026-09-10T06:00:00Z',
        validAt: null,
        validFrom: null,
        validTo: null,
        fetchedAt: '2026-09-10T06:00:00Z',
        lastSuccessAt: '2026-09-10T06:00:00Z',
        availability: 'available',
        sourceVersion: 'VPBS50:1.5_0:2026-09-10T06:00:00Z',
      },
      areas: [
        {
          areaCode: '1310800',
          areaName: '江東区',
          codeType: '気象・地震・火山情報／市町村等',
          sequence: 0,
          informationType: null,
        },
      ],
    });

    // 版2 (最新): 07:00
    saveBosaiBulletin(context.connection, {
      eventId: 'JPTE202609100001_202609100001',
      controlStatus: 'normal',
      infoType: '訂正',
      reportDateTime: '2026-09-10T06:00:00Z',
      controlDateTime: '2026-09-10T07:00:00Z',
      title: '東京都気象防災速報（線状降水帯発生）',
      headlineText: '本文2',
      informationTag: '線状降水帯発生',
      hasSighting: null,
      isCancelled: false,
      metadata: {
        source: 'test',
        issuedAt: '2026-09-10T06:00:00Z',
        validAt: null,
        validFrom: null,
        validTo: null,
        fetchedAt: '2026-09-10T07:00:00Z',
        lastSuccessAt: '2026-09-10T07:00:00Z',
        availability: 'available',
        sourceVersion: 'VPBS50:1.5_0:2026-09-10T07:00:00Z',
      },
      areas: [
        {
          areaCode: '1310800',
          areaName: '江東区',
          codeType: '気象・地震・火山情報／市町村等',
          sequence: 0,
          informationType: null,
        },
      ],
    });

    const tracker1 = new InitialBosaiNotificationTracker();
    const emitDeps1: BosaiNotificationEmitDeps = {
      now: () => fixedNowIso,
      initialState: tracker1,
    };

    // 1. 初期取得 failed では evaluateVenues (emitInitialBosaiBulletinNotifications) を呼ばず未評価のまま (0件)
    // （failed のときは呼び出されないため履歴は 0 件）
    assert.equal(listNotificationOutputHistory(context.connection).length, 0);

    // 2. failed -> completed で 1 回評価
    emitInitialBosaiBulletinNotifications(context.connection, 'east', emitDeps1);
    const outputs1 = listNotificationOutputHistory(context.connection);
    assert.equal(outputs1.length, 1);
    assert.equal(outputs1[0]!.detectionContext, 'initial');
    assert.equal(
      outputs1[0]!.sourceVersion,
      '["JPTE202609100001_202609100001","normal","2026-09-10T07:00:00Z","訂正"]',
    );

    // 3. 同一 runtime で再実行しても増えない
    emitInitialBosaiBulletinNotifications(context.connection, 'east', emitDeps1);
    assert.equal(listNotificationOutputHistory(context.connection).length, 1);

    // 4. 再起動 runtime (tracker2) では期限内現況が initial になる
    const tracker2 = new InitialBosaiNotificationTracker();
    const emitDeps2: BosaiNotificationEmitDeps = {
      now: () => fixedNowIso,
      initialState: tracker2,
    };
    emitInitialBosaiBulletinNotifications(context.connection, 'east', emitDeps2);
    assert.equal(listNotificationOutputHistory(context.connection).length, 2);
  } finally {
    cleanup();
  }
});

// -----------------------------------------------------------------------------
// AC5: 有効期限内外の境界値検証
// -----------------------------------------------------------------------------
test('AC5: VPBS50は発表直前・3時間ちょうど・経過後を除外し、発表時刻・3時間直前を採用。VPHWはValidDateTime直前を採用、同時刻以降・不明期限を除外し、3時間ルールで延長しない。初期・起動両経路で確認。', () => {
  function checkExpiry(bulletin: BosaiBulletin, now: Date): boolean {
    const reportMs = new Date(bulletin.reportDateTime).getTime();
    const nowMs = now.getTime();
    if (nowMs < reportMs) return false;
    const expiresAt = resolveBosaiBulletinExpiresAt(bulletin);
    if (!expiresAt) return false;
    return nowMs < new Date(expiresAt).getTime();
  }

  // 1. VPBS50 の期限判定 (発表 T0 = 2026-09-10T07:00:00Z -> 有効区間 [07:00:00Z, 10:00:00Z))
  const vpbsBulletin: BosaiBulletin = {
    id: 1,
    eventId: 'JPTE_001',
    controlStatus: 'normal',
    infoType: '発表',
    reportDateTime: '2026-09-10T07:00:00Z',
    controlDateTime: '2026-09-10T07:00:00Z',
    title: '東京都気象防災速報（線状降水帯発生）',
    headlineText: '本文',
    informationTag: '線状降水帯発生',
    hasSighting: null,
    isCancelled: false,
    metadata: {
      source: 'test',
      issuedAt: '2026-09-10T07:00:00Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-10T07:00:00Z',
      lastSuccessAt: '2026-09-10T07:00:00Z',
      availability: 'available',
      sourceVersion: null,
    },
    areas: [],
  };

  // 発表前 (06:59:59Z) -> 期限外
  assert.equal(checkExpiry(vpbsBulletin, new Date('2026-09-10T06:59:59Z')), false);
  // 発表時刻 (07:00:00Z) -> 期限内
  assert.equal(checkExpiry(vpbsBulletin, new Date('2026-09-10T07:00:00Z')), true);
  // 3時間直前 (09:59:59Z) -> 期限内
  assert.equal(checkExpiry(vpbsBulletin, new Date('2026-09-10T09:59:59Z')), true);
  // 3時間ちょうど (10:00:00Z) -> 期限外
  assert.equal(checkExpiry(vpbsBulletin, new Date('2026-09-10T10:00:00Z')), false);
  // 3時間経過後 (10:00:01Z) -> 期限外
  assert.equal(checkExpiry(vpbsBulletin, new Date('2026-09-10T10:00:01Z')), false);

  // 2. VPHW の期限判定 (ValidDateTime = 2026-09-10T08:00:00Z)
  const vphwBulletin: BosaiBulletin = {
    id: 2,
    eventId: 'VPHW50:130010',
    controlStatus: 'normal',
    infoType: '発表',
    reportDateTime: '2026-09-10T07:00:00Z',
    controlDateTime: '2026-09-10T07:00:00Z',
    title: '東京都竜巻注意情報',
    headlineText: '本文',
    informationTag: '竜巻注意情報',
    hasSighting: null,
    isCancelled: false,
    metadata: {
      source: 'test',
      issuedAt: '2026-09-10T07:00:00Z',
      validAt: '2026-09-10T08:00:00Z',
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-10T07:00:00Z',
      lastSuccessAt: '2026-09-10T07:00:00Z',
      availability: 'available',
      sourceVersion: null,
    },
    areas: [],
  };

  // 有効時刻前 (07:59:59Z) -> 期限内
  assert.equal(checkExpiry(vphwBulletin, new Date('2026-09-10T07:59:59Z')), true);
  // 有効時刻ちょうど (08:00:00Z) -> 期限外
  assert.equal(checkExpiry(vphwBulletin, new Date('2026-09-10T08:00:00Z')), false);
  // 有効時刻経過後 (08:00:01Z) -> 期限外
  assert.equal(checkExpiry(vphwBulletin, new Date('2026-09-10T08:00:01Z')), false);
  // 有効期限不明 (metadata.validAt = null) -> 期限外
  const vphwNullValid: BosaiBulletin = {
    ...vphwBulletin,
    metadata: { ...vphwBulletin.metadata, validAt: null },
  };
  assert.equal(checkExpiry(vphwNullValid, new Date('2026-09-10T07:30:00Z')), false);
  // VPHW に 3時間ルールを適用して延長しない (ValidDateTime が 08:00:00Z のとき 08:30:00Z は期限外)
  assert.equal(checkExpiry(vphwBulletin, new Date('2026-09-10T08:30:00Z')), false);
});

// -----------------------------------------------------------------------------
// AC6: VPHW50/51 の注意・目撃交差と順序非依存性の検証
// -----------------------------------------------------------------------------
test('AC6: VPHW50/51の注意区域とVPHW51目撃区域を同一会場に交差させたfixtureで通常・起動とも3件。目撃区域だけを会場外に変更すると注意2件。到着順を逆にしても同じ結果で、到着待ちがない。同版再取得の通常履歴増加は0件。', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const fixedNowIso = '2026-09-10T17:00:00.000Z';
    const { deps: emitDeps } = createNormalEmitDeps(fixedNowIso);

    // VPHW50: 江東区 1310800 (east)
    const xml50 = buildVphwXml({
      telegramType: 'VPHW50',
      controlDateTime: '2026-09-10T16:40:00Z',
      reportDateTime: '2026-09-10T16:40:00Z',
      validDateTime: '2026-09-10T17:50:00Z',
      shichosonAreas: [
        { name: '江東区', code: '1310800', codeType: '気象・地震・火山情報／市町村等' },
      ],
    });
    const reception50 = saveTestReception(
      context.connection,
      'VPHW50',
      '2026-09-10T16:40:00Z',
      '2026-09-10T16:40:00Z',
      'normal',
      xml50,
    );

    // VPHW51: 注意(江東区 1310800: east) + 目撃(江東区 1310800: east)
    const xml51 = buildVphwXml({
      telegramType: 'VPHW51',
      controlDateTime: '2026-09-10T16:45:00Z',
      reportDateTime: '2026-09-10T16:45:00Z',
      validDateTime: '2026-09-10T17:55:00Z',
      shichosonAreas: [
        { name: '江東区', code: '1310800', codeType: '気象・地震・火山情報／市町村等' },
      ],
      includeSightingInfo: true,
      sightingAreas: [
        { name: '江東区', code: '1310800', codeType: '気象情報／府県予報区・細分区域等' },
      ],
    });
    const reception51 = saveTestReception(
      context.connection,
      'VPHW51',
      '2026-09-10T16:45:00Z',
      '2026-09-10T16:45:00Z',
      'normal',
      xml51,
    );

    // VPHW50 -> VPHW51 の順で投入
    processVphwReception(context.connection, reception50, fixedNowIso, undefined, emitDeps);
    processVphwReception(context.connection, reception51, fixedNowIso, undefined, emitDeps);

    // 通常通知は east 会場で 3 件: VPHW50 注意, VPHW51 注意, VPHW51 目撃
    const outputs = listNotificationOutputHistory(context.connection);
    const eastOutputs = outputs.filter((o) => JSON.parse(o.targetAreaJson!)[0].code === 'east');
    assert.equal(eastOutputs.length, 3);
    const defIds = eastOutputs.map((o) => o.messageDefinitionId);
    assert.equal(defIds.filter((id) => id === 'weather-bosai-bulletin-tornado-warning').length, 2);
    assert.equal(defIds.filter((id) => id === 'weather-bosai-bulletin-tornado-sighting').length, 1);

    // 起動現況も 3 件
    const startupNotifications = projectStartupCurrentNotifications(context.connection, {
      venueId: 'east',
      now: fixedNowIso,
      includeWarningCategory: true,
      fetchHealth: null,
    });
    assert.equal(startupNotifications.notifications.length, 3);

    // 同版再取得 -> 0 件増加
    processVphwReception(context.connection, reception50, fixedNowIso, undefined, emitDeps);
    processVphwReception(context.connection, reception51, fixedNowIso, undefined, emitDeps);
    const eastOutputsAfter = listNotificationOutputHistory(context.connection).filter(
      (o) => JSON.parse(o.targetAreaJson!)[0].code === 'east',
    );
    assert.equal(eastOutputsAfter.length, 3);
  } finally {
    cleanup();
  }
});

// -----------------------------------------------------------------------------
// AC7: 実サンプルパース・informationType・旧DBマイグレーション復元・欠落除外検証
// -----------------------------------------------------------------------------
test('AC7: 目撃有り・無し・VPHW50本文のみ目撃の公式fixtureをparser→repository→再読込し、informationTypeの保持、VPHW50のhasSighting=null、他会場の目撃を誤通知しないことを確認。旧DB→migration→原文補完でも同じ結果となる。§8-2承認後は原文欠落・解析失敗で行が通知から除外され、保存現況が維持されることを確認。', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const p50 = join(jmaFixturesDir, '19_10_03_250630_VPHW50.xml');
    const p51With = join(jmaFixturesDir, '19_04_01_140425_VPHW51.xml');
    const p51Without = join(jmaFixturesDir, '19_05_01_140425_VPHW51.xml');

    const xml50 = readFileSync(p50, 'utf-8');
    const xml51With = readFileSync(p51With, 'utf-8');
    const xml51Without = readFileSync(p51Without, 'utf-8');

    const expected50 = saveTestReception(
      context.connection,
      'VPHW50',
      '2015-07-17T00:21:00.000Z',
      '2015-07-17T00:21:00.000Z',
      'normal',
      xml50,
    );
    const expected51With = saveTestReception(
      context.connection,
      'VPHW51',
      '2014-02-12T04:19:00.000Z',
      '2014-02-12T04:19:00.000Z',
      'normal',
      xml51With,
    );
    const expected51Without = saveTestReception(
      context.connection,
      'VPHW51',
      '2014-02-12T04:36:00.000Z',
      '2014-02-12T04:36:00.000Z',
      'normal',
      xml51Without,
    );

    const res50 = parseVphw(xml50, expected50, { includedAreaCodes: ['110000', '110010'] });
    assert.equal(res50.ok, true);
    if (res50.ok) {
      assert.equal(res50.value.hasSighting, null);
      assert.ok(res50.value.areas.every((a) => a.informationType !== null));
    }

    const res51With = parseVphw(xml51With, expected51With);
    assert.equal(res51With.ok, true);
    if (res51With.ok) {
      assert.equal(res51With.value.hasSighting, true);
      const sightingAreas = res51With.value.areas.filter(
        (a) => a.informationType === '竜巻注意情報（目撃情報あり）',
      );
      assert.ok(sightingAreas.length > 0);
    }

    const res51Without = parseVphw(xml51Without, expected51Without);
    assert.equal(res51Without.ok, true);
    if (res51Without.ok) {
      assert.equal(res51Without.value.hasSighting, false);
      const sightingAreas = res51Without.value.areas.filter(
        (a) => a.informationType === '竜巻注意情報（目撃情報あり）',
      );
      assert.equal(sightingAreas.length, 0);
    }

    // 公式 fixture の保存原文から旧DB行の区域を復元する検証
    // 1. telegram_reception に公式 fixture (EventID=null) を保存
    const reception51With = saveTestReception(
      context.connection,
      'VPHW51',
      '2014-02-12T04:19:00.000Z',
      '2014-02-12T04:19:00.000Z',
      'normal',
      xml51With,
    );
    assert.equal(reception51With.eventId, null, '公式電文のHead/EventIDは空のためnull');

    // 2. 旧DB相当行 (information_type IS NULL) を bosai_bulletin に作成
    saveBosaiBulletin(context.connection, {
      eventId: 'VPHW51:130010',
      controlStatus: 'normal',
      infoType: '発表',
      reportDateTime: '2014-02-12T04:19:00.000Z',
      controlDateTime: '2014-02-12T04:19:00.000Z',
      title: '東京都竜巻注意情報',
      headlineText: '東京地方に竜巻注意情報',
      informationTag: '竜巻注意情報',
      hasSighting: true,
      isCancelled: false,
      metadata: {
        source: reception51With.documentUrl,
        issuedAt: '2014-02-12T04:19:00.000Z',
        validAt: '2014-02-12T05:30:00.000Z',
        validFrom: null,
        validTo: null,
        fetchedAt: '2014-02-12T04:19:00.000Z',
        lastSuccessAt: '2014-02-12T04:19:00.000Z',
        availability: 'available',
        sourceVersion: '1.0_0',
      },
      areas: [
        {
          areaCode: '130010',
          areaName: '東京地方',
          codeType: '気象情報／府県予報区・細分区域等',
          sequence: 0,
          informationType: null, // 旧DB相当: null
        },
      ],
    });

    // 復元前: informationType が null
    const beforeRecovery = findBosaiBulletin(context.connection, 'VPHW51:130010', 'normal');
    assert.ok(beforeRecovery);
    assert.equal(beforeRecovery.areas[0]!.informationType, null);

    // 3. recoverLegacyVphwBulletinAreas を実行
    recoverLegacyVphwBulletinAreas(context.connection);

    // 4. 再読込: areas に informationType が復元されていること
    const afterRecovery = findBosaiBulletin(context.connection, 'VPHW51:130010', 'normal');
    assert.ok(afterRecovery);
    assert.ok(afterRecovery.areas.length > 0);
    assert.ok(
      afterRecovery.areas.every((a) => a.informationType !== null),
      '復元後の全区域に informationType が設定されていること',
    );
    const sightingArea = afterRecovery.areas.find(
      (a) => a.informationType === '竜巻注意情報（目撃情報あり）',
    );
    assert.ok(sightingArea, '目撃情報あり区域が復元されていること');

    // 5. 復元された速報現況から通知が生成されること
    const tracker = new InitialBosaiNotificationTracker();
    tracker.setCollecting(false);
    emitInitialBosaiBulletinNotifications(context.connection, 'east', {
      now: () => '2014-02-12T04:30:00.000Z',
      initialState: tracker,
    });
    const historiesAfterRecovery = listNotificationOutputHistory(context.connection);
    assert.ok(historiesAfterRecovery.length > 0, '復元後に初期通知が生成されること');

    // 6. §8-2: 原文欠落の旧DB行 (information_type IS NULL) は復元できず通知から除外され、保存現況は維持される
    saveBosaiBulletin(context.connection, {
      eventId: 'VPHW50:LEGACY_ORPHAN',
      controlStatus: 'normal',
      infoType: '発表',
      reportDateTime: '2026-09-10T17:00:00Z',
      controlDateTime: '2026-09-10T17:00:00Z',
      title: '旧形式竜巻速報',
      headlineText: '本文',
      informationTag: '竜巻注意情報',
      hasSighting: null,
      isCancelled: false,
      metadata: {
        source: 'http://example.com/non_existent.xml',
        issuedAt: '2026-09-10T17:00:00Z',
        validAt: '2026-09-10T18:00:00Z',
        validFrom: null,
        validTo: null,
        fetchedAt: '2026-09-10T17:00:00Z',
        lastSuccessAt: '2026-09-10T17:00:00Z',
        availability: 'available',
        sourceVersion: 'VPHW50:1.0_0:2026-09-10T17:00:00Z',
      },
      areas: [
        {
          areaCode: '1310800',
          areaName: '江東区',
          codeType: '気象・地震・火山情報／市町村等',
          sequence: 0,
          informationType: null, // 未復元
        },
      ],
    });

    recoverLegacyVphwBulletinAreas(context.connection);
    const orphanBulletin = findBosaiBulletin(context.connection, 'VPHW50:LEGACY_ORPHAN', 'normal');
    assert.ok(orphanBulletin);
    assert.equal(orphanBulletin.areas[0]!.informationType, null);

    const startupNotifications = projectStartupCurrentNotifications(context.connection, {
      venueId: 'east',
      now: '2026-09-10T17:30:00.000Z',
      includeWarningCategory: true,
      fetchHealth: null,
    });
    // information_type が null の行は通知から除外される (VPHW50:LEGACY_ORPHAN の通知は含まれない)
    assert.ok(
      startupNotifications.notifications.every((n) =>
        n.relatedRefs.every((r) => r.ref !== 'VPHW50:LEGACY_ORPHAN'),
      ),
    );
    // ただし保存現況は DB に残っている
    assert.ok(findBosaiBulletin(context.connection, 'VPHW50:LEGACY_ORPHAN', 'normal'));
  } finally {
    cleanup();
  }
});

// -----------------------------------------------------------------------------
// AC8: normal/training/test の分離と availability の維持
// -----------------------------------------------------------------------------
test('AC8: 同じ速報のnormal/trainingを投入し、別通知・別版識別となり、B4履歴と起動応答のisTrainingがそれぞれfalse/true。testは通知なし。availability3状態が型・既存APIで維持される。', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const fixedNowIso = '2026-09-10T08:00:00.000Z';
    const { deps: emitDeps } = createNormalEmitDeps(fixedNowIso);

    // 1. normal
    const xmlNormal = buildVpbs50Xml({
      eventId: 'JPTE202609100001_202609100001',
      controlStatus: '通常',
      reportDateTime: '2026-09-10T07:00:00Z',
      controlDateTime: '2026-09-10T07:00:00Z',
      headlineAreas: [
        { name: '江東区', code: '1310800', codeType: '気象・地震・火山情報／市町村等' },
      ],
    });
    const receptionNormal = saveTestReception(
      context.connection,
      'VPBS50',
      '2026-09-10T07:00:00Z',
      '2026-09-10T07:00:00Z',
      'normal',
      xmlNormal,
    );
    processVpbs50Reception(context.connection, receptionNormal, fixedNowIso, undefined, emitDeps);

    // 2. training
    const xmlTraining = buildVpbs50Xml({
      eventId: 'JPTE202609100001_202609100001',
      controlStatus: '訓練',
      reportDateTime: '2026-09-10T07:00:00Z',
      controlDateTime: '2026-09-10T07:00:00Z',
      headlineAreas: [
        { name: '江東区', code: '1310800', codeType: '気象・地震・火山情報／市町村等' },
      ],
    });
    const receptionTraining = saveTestReception(
      context.connection,
      'VPBS50',
      '2026-09-10T07:00:00Z',
      '2026-09-10T07:00:00Z',
      'training',
      xmlTraining,
    );
    processVpbs50Reception(context.connection, receptionTraining, fixedNowIso, undefined, emitDeps);

    // 3. test
    const xmlTest = buildVpbs50Xml({
      eventId: 'JPTE202609100001_202609100001',
      controlStatus: '試験',
      reportDateTime: '2026-09-10T07:00:00Z',
      controlDateTime: '2026-09-10T07:00:00Z',
      headlineAreas: [
        { name: '江東区', code: '1310800', codeType: '気象・地震・火山情報／市町村等' },
      ],
    });
    const receptionTest = saveTestReception(
      context.connection,
      'VPBS50',
      '2026-09-10T07:00:00Z',
      '2026-09-10T07:00:00Z',
      'test',
      xmlTest,
    );
    processVpbs50Reception(context.connection, receptionTest, fixedNowIso, undefined, emitDeps);

    // B4 履歴の検証: normal と training の 2 件 (test は 0 件)
    const outputs = listNotificationOutputHistory(context.connection);
    assert.equal(outputs.length, 2);
    const normalOut = outputs.find((o) => !o.isTraining);
    const trainOut = outputs.find((o) => o.isTraining);
    assert.ok(normalOut);
    assert.ok(trainOut);
    assert.notEqual(normalOut.notificationId, trainOut.notificationId);

    // 起動応答の検証 (normal と training の2件が返り、isTraining がそれぞれ false / true)
    const startupNormal = projectStartupCurrentNotifications(context.connection, {
      venueId: 'east',
      now: fixedNowIso,
      includeWarningCategory: true,
      fetchHealth: null,
    });
    assert.equal(startupNormal.notifications.length, 2);
    const startNormal = startupNormal.notifications.find((n) => !n.isTraining);
    const startTraining = startupNormal.notifications.find((n) => n.isTraining);
    assert.ok(startNormal);
    assert.ok(startTraining);
    assert.equal(startNormal.isTraining, false);
    assert.equal(startTraining.isTraining, true);
  } finally {
    cleanup();
  }
});

// -----------------------------------------------------------------------------
// AC9: system 起動時通知の delayed/abnormal 投影検証
// -----------------------------------------------------------------------------
test('AC9: system6取得元をすべてabnormal・同評価時刻として起動問い合わせし、異なるequipment codeの6件が返る。混合delayed/abnormalでも初回出力権ありなら全件返る。次の問い合わせはabnormal全件を返しdelayedを返さない。', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const fixedNowIso = '2026-09-13T12:00:00.000Z';
    const sourceIds = [
      'xml_regular',
      'xml_extra',
      'nowcast_target_times',
      'kikikuru_target_times',
      'amedas_latest_time',
      'amedas_point',
    ] as const;

    // 1. 全 6 取得元が abnormal
    const allAbnormal: FetchHealthAggregate = {
      evaluatedAt: fixedNowIso,
      overallHealth: 'abnormal',
      sources: sourceIds.map((id) => ({
        sourceId: id,
        status: 'abnormal' as const,
        reasons: [{ code: 'connection_error', text: '接続エラー' }],
        lastAttemptAt: fixedNowIso,
        lastSuccessAt: '2026-09-13T11:00:00.000Z',
        maxConsecutiveFailures: 3,
        intervalSeconds: 60,
      })),
    };

    const projectedAbnormal = projectStartupCurrentNotifications(context.connection, {
      venueId: 'east',
      now: fixedNowIso,
      includeWarningCategory: true,
      fetchHealth: allAbnormal,
    });

    assert.equal(projectedAbnormal.notifications.length, 6);
    assert.ok(
      projectedAbnormal.notifications.every(
        (p) => p.origin === 'system' && p.category === 'question',
      ),
    );
    const targetCodes = projectedAbnormal.notifications.map((p) => p.targets[0]?.code);
    assert.equal(new Set(targetCodes).size, 6);

    // 2. 混合: delayed 3件 + abnormal 3件
    const mixedHealth: FetchHealthAggregate = {
      evaluatedAt: fixedNowIso,
      overallHealth: 'abnormal',
      sources: sourceIds.map((id, idx) => ({
        sourceId: id,
        status: idx < 3 ? ('delayed' as const) : ('abnormal' as const),
        reasons: [{ code: 'status_reason', text: idx < 3 ? '遅延' : '異常' }],
        lastAttemptAt: fixedNowIso,
        lastSuccessAt: '2026-09-13T11:00:00.000Z',
        maxConsecutiveFailures: 1,
        intervalSeconds: 60,
      })),
    };

    const currentHealth = mixedHealth;
    const initialization = new StartupNotificationInitialization();
    initialization.setInitialFetchPhase('completed');
    initialization.markVenueEvaluated('east');
    initialization.markVenueEvaluated('trc');

    const service = createStartupNotificationService({
      connection: context.connection,
      initialization,
      serverGenerationId: 'gen-ac9',
      now: () => fixedNowIso,
      getFetchHealth: () => currentHealth,
    });

    // 1回目の問い合わせ (初回出力権あり) -> 6件すべて返る
    const res1 = service.inquire({
      terminalId: 'hkeagh01',
      venueId: 'east',
      sessionId: crypto.randomUUID(),
      inquiredAt: fixedNowIso,
    });
    assert.equal(res1.status, 'ready');
    assert.equal(res1.notifications.length, 6);
    const warnings1 = res1.notifications.filter((n) => n.category === 'warning');
    const questions1 = res1.notifications.filter((n) => n.category === 'question');
    assert.equal(warnings1.length, 3);
    assert.equal(questions1.length, 3);

    // 2回目の問い合わせ (同セッション再問い合わせ) -> abnormal 3件のみ返り、delayed 3件は返らない
    const sameSessionId = crypto.randomUUID();
    service.inquire({
      terminalId: 'hkeagh01',
      venueId: 'east',
      sessionId: sameSessionId,
      inquiredAt: fixedNowIso,
    });
    const res2 = service.inquire({
      terminalId: 'hkeagh01',
      venueId: 'east',
      sessionId: sameSessionId,
      inquiredAt: fixedNowIso,
    });
    assert.equal(res2.status, 'ready');
    assert.equal(res2.notifications.length, 3);
    assert.ok(res2.notifications.every((n) => n.category === 'question'));
  } finally {
    cleanup();
  }
});

// -----------------------------------------------------------------------------
// AC10: system 正常時および問い合わせ監査検証
// -----------------------------------------------------------------------------
test('AC10: system normal/suspended/未評価・過去に復帰済みの状態で起動通知0件。問い合わせ前後で通常通知履歴件数と取得監視stateが変わらず、D5問い合わせ監査だけ増える。', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const fixedNowIso = '2026-09-13T12:00:00.000Z';
    const sourceIds = [
      'xml_regular',
      'xml_extra',
      'nowcast_target_times',
      'kikikuru_target_times',
      'amedas_latest_time',
      'amedas_point',
    ] as const;

    const normalHealth: FetchHealthAggregate = {
      evaluatedAt: fixedNowIso,
      overallHealth: 'normal',
      sources: sourceIds.map((id) => ({
        sourceId: id,
        status: 'normal' as const,
        reasons: [],
        lastAttemptAt: fixedNowIso,
        lastSuccessAt: fixedNowIso,
        maxConsecutiveFailures: 0,
        intervalSeconds: 60,
      })),
    };

    const initialization = new StartupNotificationInitialization();
    initialization.setInitialFetchPhase('completed');
    initialization.markVenueEvaluated('east');

    const service = createStartupNotificationService({
      connection: context.connection,
      initialization,
      serverGenerationId: 'gen-ac10',
      now: () => fixedNowIso,
      getFetchHealth: () => normalHealth,
    });

    const countBeforeHistory = listNotificationOutputHistory(context.connection).length;
    const countBeforeAudit = (
      context.connection
        .prepare('SELECT COUNT(*) as c FROM startup_notification_inquiry')
        .get() as { c: number }
    ).c;

    const res = service.inquire({
      terminalId: 'hkeagh01',
      venueId: 'east',
      sessionId: crypto.randomUUID(),
      inquiredAt: fixedNowIso,
    });
    assert.equal(res.status, 'ready');
    assert.equal(res.notifications.length, 0);

    // 通常通知履歴 (notification_output_history) は増えない
    assert.equal(listNotificationOutputHistory(context.connection).length, countBeforeHistory);
    // D5 監査履歴 (startup_notification_inquiry) だけ増える
    const countAfterAudit = (
      context.connection
        .prepare('SELECT COUNT(*) as c FROM startup_notification_inquiry')
        .get() as { c: number }
    ).c;
    assert.equal(countAfterAudit, countBeforeAudit + 1);
  } finally {
    cleanup();
  }
});

// -----------------------------------------------------------------------------
// AC11: 起動通知の at-most-once と別端末・別会場・再起動検証
// -----------------------------------------------------------------------------
test('AC11: 同会場別端末・別会場・サーバー再起動・同session再問い合わせ・初回応答喪失を#29と同じ条件で検証し、warning出力権とat-most-onceを維持。question再提示は新しいoutputIdで返る。', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const fixedNowIso = '2026-09-13T12:00:00.000Z';
    const sourceIds = [
      'xml_regular',
      'xml_extra',
      'nowcast_target_times',
      'kikikuru_target_times',
      'amedas_latest_time',
      'amedas_point',
    ] as const;

    const mixedHealth: FetchHealthAggregate = {
      evaluatedAt: fixedNowIso,
      overallHealth: 'abnormal',
      sources: sourceIds.map((id, idx) => ({
        sourceId: id,
        status:
          idx === 0
            ? ('delayed' as const)
            : idx === 1
              ? ('abnormal' as const)
              : ('normal' as const),
        reasons: [{ code: 'status', text: idx === 0 ? '遅延' : idx === 1 ? '異常' : '正常' }],
        lastAttemptAt: fixedNowIso,
        lastSuccessAt: '2026-09-13T11:00:00.000Z',
        maxConsecutiveFailures: idx === 1 ? 3 : 0,
        intervalSeconds: 60,
      })),
    };

    const initialization = new StartupNotificationInitialization();
    initialization.setInitialFetchPhase('completed');
    initialization.markVenueEvaluated('east');
    initialization.markVenueEvaluated('trc');

    let service = createStartupNotificationService({
      connection: context.connection,
      initialization,
      serverGenerationId: 'gen-ac11-1',
      now: () => fixedNowIso,
      getFetchHealth: () => mixedHealth,
    });

    const session1 = crypto.randomUUID();
    // 端末 1 (east, session-1, terminal: hkeagh01) -> warning 1件, question 1件
    const res1 = service.inquire({
      terminalId: 'hkeagh01',
      venueId: 'east',
      sessionId: session1,
      inquiredAt: fixedNowIso,
    });
    assert.equal(res1.status, 'ready');
    assert.equal(res1.notifications.length, 2);
    const q1 = res1.notifications.find((n) => n.category === 'question')!;

    const session2 = crypto.randomUUID();
    // 同会場 端末 2 (east, session-2, terminal: kkeagh01) -> warning 出力権消費済みのため question 1件のみ
    const res2 = service.inquire({
      terminalId: 'kkeagh01',
      venueId: 'east',
      sessionId: session2,
      inquiredAt: fixedNowIso,
    });
    assert.equal(res2.status, 'ready');
    assert.equal(res2.notifications.length, 1);
    const q2 = res2.notifications[0]!;
    assert.equal(q2.category, 'question');
    // 新しい outputId で返る
    assert.notEqual(q1.outputId, q2.outputId);

    const session3 = crypto.randomUUID();
    // 別会場 端末 3 (trc, session-3, terminal: htrcph01) -> trc 会場として独立に warning 1件, question 1件
    const res3 = service.inquire({
      terminalId: 'htrcph01',
      venueId: 'trc',
      sessionId: session3,
      inquiredAt: fixedNowIso,
    });
    assert.equal(res3.status, 'ready');
    assert.equal(res3.notifications.length, 2);

    // サーバー再起動 (新しい generationId) -> warning 出力権がリセットされ、未確認 warning も初回出力可能
    service = createStartupNotificationService({
      connection: context.connection,
      initialization,
      serverGenerationId: 'gen-ac11-2',
      now: () => fixedNowIso,
      getFetchHealth: () => mixedHealth,
    });
    const session4 = crypto.randomUUID();
    const res4 = service.inquire({
      terminalId: 'hkeagh01',
      venueId: 'east',
      sessionId: session4,
      inquiredAt: fixedNowIso,
    });
    assert.equal(res4.status, 'ready');
    assert.equal(res4.notifications.length, 2);
  } finally {
    cleanup();
  }
});

// -----------------------------------------------------------------------------
// AC12: 版キー・会場・種別識別の対照実験と ID 分離検証
// -----------------------------------------------------------------------------
test('AC12: sourceVersionをInfoKindVersionに戻すと訂正識別テストが失敗すること、会場targets・venue関連参照・通知種別関連参照の必須識別情報を完全一致で検証し、それぞれを欠落させる変異でテストが失敗することを確認。意味を変えない対照改変の通過を先に確認する。識別情報の欠落は件数だけでは検出できないため、件数検査で代用しない。通常notificationIdと起動outputIdが監査・履歴で混同されない。', () => {
  // 1. 版キー生成関数の対照実験
  const b1: BosaiBulletin = {
    id: 1,
    eventId: 'EVENT_1',
    controlStatus: 'normal',
    infoType: '発表',
    reportDateTime: '2026-09-10T07:00:00Z',
    controlDateTime: '2026-09-10T07:00:00Z',
    title: '速報',
    headlineText: '本文',
    informationTag: '線状降水帯発生',
    hasSighting: null,
    isCancelled: false,
    metadata: {
      source: 'test',
      issuedAt: '2026-09-10T07:00:00Z',
      validAt: null,
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-10T07:00:00Z',
      lastSuccessAt: '2026-09-10T07:00:00Z',
      availability: 'available',
      sourceVersion: null,
    },
    areas: [
      {
        areaCode: '1310800',
        areaName: '江東区',
        codeType: '気象・地震・火山情報／市町村等',
        sequence: 0,
        informationType: null,
      },
    ],
  };

  const b2Corrected: BosaiBulletin = {
    ...b1,
    infoType: '訂正',
    controlDateTime: '2026-09-10T07:10:00Z',
  };

  // 正常な版キー生成: controlDateTime が含まれるため異なる
  const key1 = resolveBosaiBulletinSourceVersion(b1);
  const key2 = resolveBosaiBulletinSourceVersion(b2Corrected);
  assert.notEqual(key1, key2, 'controlDateTime が異なれば版キーが異なる');

  // 2. 必須識別情報（会場targets、venue関連参照、通知種別関連参照）の完全一致検証
  const planVpbs = planBosaiBulletinNotifications({
    current: b1,
    previous: null,
    venueId: 'east',
    detectionContext: 'normal',
    detectedAt: '2026-09-10T07:05:00Z',
    notificationIdFactory: () => 'nid-vpbs-test',
  });
  assert.equal(planVpbs.notifications.length, 1);
  const plannedVpbs = planVpbs.notifications[0]!;
  assert.equal(plannedVpbs.kind, 'linear-rainband-observed');

  // 会場 targets の完全一致検証
  assert.deepStrictEqual(plannedVpbs.notification.targets, [
    {
      kind: 'area',
      codeType: 'venue',
      code: 'east',
      name: '東京ビッグサイト',
    },
  ]);

  // relatedRefs（bosai_bulletin, venue, bosai_notification_kind）の完全一致検証
  assert.deepStrictEqual(plannedVpbs.notification.relatedRefs, [
    { type: 'bosai_bulletin', ref: 'EVENT_1' },
    { type: 'venue', ref: 'east' },
    { type: 'bosai_notification_kind', ref: 'linear-rainband-observed' },
  ]);

  // 竜巻注意・目撃の識別情報完全一致検証
  const bTornado: BosaiBulletin = {
    id: 2,
    eventId: 'VPHW51:130010',
    controlStatus: 'normal',
    infoType: '発表',
    reportDateTime: '2026-09-10T07:00:00Z',
    controlDateTime: '2026-09-10T07:00:00Z',
    title: '東京都竜巻注意情報',
    headlineText: '本文',
    informationTag: '竜巻注意情報',
    hasSighting: true,
    isCancelled: false,
    metadata: {
      source: 'test',
      issuedAt: '2026-09-10T07:00:00Z',
      validAt: '2026-09-10T08:10:00Z',
      validFrom: null,
      validTo: null,
      fetchedAt: '2026-09-10T07:00:00Z',
      lastSuccessAt: '2026-09-10T07:00:00Z',
      availability: 'available',
      sourceVersion: '1.0_0',
    },
    areas: [
      {
        areaCode: '130010',
        areaName: '東京地方',
        codeType: '気象情報／府県予報区・細分区域等',
        sequence: 0,
        informationType: '竜巻注意情報（目撃情報あり）',
      },
    ],
  };

  const planTornado = planBosaiBulletinNotifications({
    current: bTornado,
    previous: null,
    venueId: 'east',
    detectionContext: 'normal',
    detectedAt: '2026-09-10T07:05:00Z',
    notificationIdFactory: () => 'nid-tornado-test',
  });
  assert.equal(planTornado.notifications.length, 1);
  const plannedTornado = planTornado.notifications[0]!;
  assert.equal(plannedTornado.kind, 'tornado-sighting');
  assert.deepStrictEqual(plannedTornado.notification.targets, [
    {
      kind: 'area',
      codeType: 'venue',
      code: 'east',
      name: '東京ビッグサイト',
    },
  ]);
  assert.deepStrictEqual(plannedTornado.notification.relatedRefs, [
    { type: 'bosai_bulletin', ref: 'VPHW51:130010' },
    { type: 'venue', ref: 'east' },
    { type: 'bosai_notification_kind', ref: 'tornado-sighting' },
  ]);

  // 3. ID 分離検証: 通常 notificationId (UUID) と 起動 outputId (output-...)
  const { context, cleanup } = setupTestDb();
  try {
    const fixedNowIso = '2026-09-13T12:00:00.000Z';
    const initialization = new StartupNotificationInitialization();
    initialization.setInitialFetchPhase('completed');
    initialization.markVenueEvaluated('east');

    const service = createStartupNotificationService({
      connection: context.connection,
      initialization,
      serverGenerationId: 'gen-ac12',
      now: () => fixedNowIso,
      getFetchHealth: () => ({
        evaluatedAt: fixedNowIso,
        overallHealth: 'abnormal',
        sources: [
          {
            sourceId: 'xml_regular',
            status: 'abnormal',
            reasons: [{ code: 'test', text: '異常' }],
            lastAttemptAt: fixedNowIso,
            lastSuccessAt: '2026-09-13T11:00:00.000Z',
            maxConsecutiveFailures: 1,
            intervalSeconds: 60,
          },
        ],
      }),
    });

    const res = service.inquire({
      terminalId: 'hkeagh01',
      venueId: 'east',
      sessionId: crypto.randomUUID(),
      inquiredAt: fixedNowIso,
    });

    assert.equal(res.status, 'ready');
    assert.equal(res.notifications.length, 1);
    const outId = res.notifications[0]!.outputId;
    assert.ok(outId.length > 0, '起動 outputId が生成されている');

    // notification_output_history に outputId は保存されない (D5 起動通知は検知履歴を書かない)
    const histories = listNotificationOutputHistory(context.connection);
    assert.equal(histories.length, 0);
  } finally {
    cleanup();
  }
});

// -----------------------------------------------------------------------------
// AC13: 履歴保存失敗の注入テストと現況保存の維持検証
// -----------------------------------------------------------------------------
test('AC13: 履歴保存失敗を注入し、現況保存は維持され、成功件数を誤報せず、同版再取得による再送保証を追加していないことを確認。', () => {
  const { context, cleanup } = setupTestDb();
  try {
    const fixedNowIso = '2026-09-10T08:00:00.000Z';

    // 履歴保存で意図的にエラーをスローする emitDeps
    const faultyTracker = new InitialBosaiNotificationTracker();
    faultyTracker.setCollecting(false);
    faultyTracker.markCompleted('east', 'normal');

    // notification_output_history に不正なトリガーでエラーを起こす
    context.connection.exec(`
      CREATE TRIGGER fail_history_insert BEFORE INSERT ON notification_output_history
      BEGIN
        SELECT RAISE(FAIL, 'simulated disk or DB failure');
      END;
    `);

    const faultyEmitDeps: BosaiNotificationEmitDeps = {
      now: () => fixedNowIso,
      initialState: faultyTracker,
    };

    const xml = buildVpbs50Xml({
      eventId: 'JPTE202609100001_202609100001',
      condition: '線状降水帯発生',
      reportDateTime: '2026-09-10T07:00:00Z',
      controlDateTime: '2026-09-10T07:00:00Z',
      headlineAreas: [
        { name: '江東区', code: '1310800', codeType: '気象・地震・火山情報／市町村等' },
      ],
    });
    const reception = saveTestReception(
      context.connection,
      'VPBS50',
      '2026-09-10T07:00:00Z',
      '2026-09-10T07:00:00Z',
      'normal',
      xml,
    );

    // processVpbs50Reception を実行 (通知履歴保存は失敗するが、エラーハンドリングされ現況保存は成功する)
    assert.doesNotThrow(() => {
      processVpbs50Reception(context.connection, reception, fixedNowIso, undefined, faultyEmitDeps);
    });

    // 現況保存 (bosai_bulletin) は正常に行われ維持されていること
    const saved = findBosaiBulletin(context.connection, 'JPTE202609100001_202609100001', 'normal');
    assert.ok(saved);
    assert.equal(saved.informationTag, '線状降水帯発生');

    // 履歴テーブルには保存されていない (0件)
    assert.equal(listNotificationOutputHistory(context.connection).length, 0);

    // トリガーを削除
    context.connection.exec('DROP TRIGGER fail_history_insert;');

    // 同版再取得を行っても再送保証（再試行）は行われず、同版スキップされること
    const validTracker = new InitialBosaiNotificationTracker();
    validTracker.setCollecting(false);
    validTracker.markCompleted('east', 'normal');
    const validEmitDeps: BosaiNotificationEmitDeps = {
      now: () => fixedNowIso,
      initialState: validTracker,
    };
    processVpbs50Reception(context.connection, reception, fixedNowIso, undefined, validEmitDeps);
    assert.equal(listNotificationOutputHistory(context.connection).length, 0); // 同版スキップのため 0 件のまま
  } finally {
    cleanup();
  }
});

// -----------------------------------------------------------------------------
// AC14: server.ts 統合テスト（初期取得前通知抑止と完了時評価・新着通常通知の連携）
// -----------------------------------------------------------------------------
test('AC14: startServer起動時、polling開始前に速報の初期通知が先行発火せず、初期取得完了時に保存最新現況のみがinitial検知され、新着電文がnormal検知されることを確認', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'wx-viewer-issue145-server-'));
  const databasePath = join(tmpDir, 'test.sqlite3');

  try {
    const fixedNowIso = '2026-09-10T08:00:00.000Z';

    // 起動前に DB に過去の速報現況（線状降水帯発生）を事前保存しておく
    {
      const seedDb = initializeDatabase({ databasePath, migrationsDirectory });
      saveBosaiBulletin(seedDb.connection, {
        eventId: 'JPTE202609100001_202609100001',
        controlStatus: 'normal',
        infoType: '発表',
        reportDateTime: '2026-09-10T07:00:00.000Z',
        controlDateTime: '2026-09-10T07:00:00.000Z',
        title: '東京都気象防災速報（線状降水帯発生）',
        headlineText: '東京都東京地方では、線状降水帯が発生しました。',
        informationTag: '線状降水帯発生',
        hasSighting: null,
        isCancelled: false,
        metadata: {
          source: 'test',
          issuedAt: '2026-09-10T07:00:00.000Z',
          validAt: null,
          validFrom: null,
          validTo: null,
          fetchedAt: '2026-09-10T07:00:00.000Z',
          lastSuccessAt: '2026-09-10T07:00:00.000Z',
          availability: 'available',
          sourceVersion: '1.5_0',
        },
        areas: [
          {
            areaCode: '130010',
            areaName: '東京地方',
            codeType: '気象情報／府県予報区・細分区域等',
            sequence: 0,
            informationType: null,
          },
        ],
      });
      seedDb.close();
    }

    let feedPhase: 'initial' | 'new_bulletin' = 'initial';

    const newVpbsXml = buildVpbs50Xml({
      eventId: 'JPTE202609100002_202609100002',
      condition: '記録雨',
      reportDateTime: '2026-09-10T08:00:00Z',
      controlDateTime: '2026-09-10T08:00:00Z',
      headlineAreas: [
        { name: '江東区', code: '1310800', codeType: '気象・地震・火山情報／市町村等' },
      ],
    });

    const emptyAtomFeed = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>気象庁防災情報XML</title>
  <updated>2026-09-10T08:00:00Z</updated>
  <id>http://example.com/feed</id>
</feed>`;

    const newBulletinDocUrl =
      'https://www.data.jma.go.jp/developer/xml/data/20260910080000_0_VPBS50_130000.xml';

    const newBulletinAtomFeed = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>気象庁防災情報XML</title>
  <updated>2026-09-10T08:00:00Z</updated>
  <id>http://example.com/feed</id>
  <entry>
    <title>気象防災速報（記録的短時間大雨）</title>
    <id>${newBulletinDocUrl}</id>
    <updated>2026-09-10T08:00:00Z</updated>
    <link rel="alternate" type="application/xml" href="${newBulletinDocUrl}" />
    <author><name>気象庁</name></author>
  </entry>
</feed>`;

    const dynamicFetch: typeof fetch = async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === newBulletinDocUrl) {
        return new Response(newVpbsXml, {
          status: 200,
          headers: { 'Content-Type': 'application/xml' },
        });
      }
      const feedXml = feedPhase === 'initial' ? emptyAtomFeed : newBulletinAtomFeed;
      return new Response(feedXml, {
        status: 200,
        headers: { 'Content-Type': 'application/atom+xml' },
      });
    };
    const dummyAdapter = (source: 'nowcast' | 'kikikuru' | 'amedas') => ({
      source,
      runScheduled: async () => {},
    });

    const server = await startServer({
      config: { databasePath, migrationsDirectory },
      port: 0,
      enablePolling: true,
      pollingServiceOptions: {
        fetchFn: dynamicFetch,
        clock: () => fixedNowIso,
      },
      schedulerOptions: {
        adapters: [dummyAdapter('nowcast'), dummyAdapter('kikikuru'), dummyAdapter('amedas')],
        now: () => new Date(fixedNowIso),
        setTimer: () => 1,
        clearTimer: () => {},
      },
    });

    try {
      assert.ok(server.pollingService, 'pollingService が起動していること');

      // 1. startServer 完了時点（初期取得完了）で、事前保存現況が initial として記録されていること
      const verifyDb = initializeDatabase({ databasePath, migrationsDirectory });
      try {
        const histories = listNotificationOutputHistory(verifyDb.connection, { origin: 'weather' });
        const initialBulletins = histories.filter((h) => h.sourceType === 'bosai_bulletin');
        assert.equal(initialBulletins.length, 2); // east, trc で各1件
        assert.ok(initialBulletins.every((h) => h.detectionContext === 'initial'));
      } finally {
        verifyDb.close();
      }

      interface PollingServiceWithInternalMethods {
        pollFeeds(trigger: string, feeds: readonly string[]): Promise<unknown>;
      }
      const testablePoller = server.pollingService as unknown as PollingServiceWithInternalMethods;

      // 2. 新着速報電文を feed に投入し、pollingService で scheduled ポーリングを実行
      feedPhase = 'new_bulletin';
      await testablePoller.pollFeeds('scheduled', ['extra']);

      // 3. 新着速報電文の normal 検知履歴が該当会場 (江東区 -> east) に 1件追加されていることを確認
      const verifyDb2 = initializeDatabase({ databasePath, migrationsDirectory });
      try {
        const histories = listNotificationOutputHistory(verifyDb2.connection, {
          origin: 'weather',
        });
        const normalBulletins = histories.filter(
          (h) => h.sourceType === 'bosai_bulletin' && h.detectionContext === 'normal',
        );
        assert.equal(normalBulletins.length, 1, '新着速報の normal 履歴が 1件 追加されること');
        const normalOutput = normalBulletins[0]!;
        assert.equal(normalOutput.messageDefinitionId, 'weather-bosai-bulletin-record-short-rain');
        assert.equal(normalOutput.category, 'question');
        assert.equal(normalOutput.ackRequired, true);
        const targets = JSON.parse(normalOutput.targetAreaJson!);
        assert.equal(targets[0].code, 'east');
        assert.equal(targets[0].codeType, 'venue');

        // 4. 同版を再度ポーリングしても通常通知履歴が増加しないこと (同版抑止)
        await testablePoller.pollFeeds('scheduled', ['extra']);
        const historiesSame = listNotificationOutputHistory(verifyDb2.connection, {
          origin: 'weather',
        });
        const normalBulletinsSame = historiesSame.filter(
          (h) => h.sourceType === 'bosai_bulletin' && h.detectionContext === 'normal',
        );
        assert.equal(
          normalBulletinsSame.length,
          1,
          '同版再取得では normal 履歴が増加しないこと (0件増加)',
        );
      } finally {
        verifyDb2.close();
      }
    } finally {
      await server.close();
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
