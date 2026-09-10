import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVphw } from '../src/polling/jmaVphwParser.js';
import type {
  BosaiBulletinTarget,
  TelegramReception,
  VphwTelegramType,
} from '../src/repositories/types.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const jmaFixturesDir = join(apiRoot, 'tests/fixtures/jma');

const defaultExpectedVphw50: Pick<
  TelegramReception,
  'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
> = {
  telegramType: 'VPHW50',
  controlStatus: 'normal',
  reportDateTime: '2009-08-09T22:38:00.000Z',
  controlDateTime: '2009-08-09T22:38:36.000Z',
};

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
  multipleSaibunItems?: boolean;
  multipleSaibunAreas?: boolean;
  saibunKindName?: string;
  saibunCondition?: string;
  saibunAreaCode?: string;
  saibunAreaName?: string;
  saibunOmitCodeType?: boolean;
  saibunOmitCode?: boolean;
  omitIchijiInfo?: boolean;
  omitMatometaInfo?: boolean;
  omitShichosonInfo?: boolean;
  includeSightingInfo?: boolean;
  sightingCondition?: string;
  sightingAreas?: Array<{ name: string; code: string; codeType?: string }>;
  extraUnknownInfoType?: string;
  reportNamespace?: string;
  headNamespace?: string;
  customXml?: string;
}

/** 公式サンプル 19_01_01_091210_VPHW50.xml をベースとした合成 XML ビルダー */
function buildVphwXml(options: BuildVphwXmlOptions = {}): string {
  if (options.customXml) return options.customXml;

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

  const reportNs = options.reportNamespace ?? 'http://xml.kishou.go.jp/jmaxml1/';
  const headNs = options.headNamespace ?? 'http://xml.kishou.go.jp/jmaxml1/informationBasis1/';

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

  // 1. 発表細分 Information
  let saibunXml = '';
  if (!options.omitSaibunInfo) {
    const codeTypeAttr = options.saibunOmitCodeType
      ? ''
      : ' codeType="気象情報／府県予報区・細分区域等"';
    const code = options.saibunAreaCode ?? '130010';
    const name = options.saibunAreaName ?? '東京地方';
    const codeNode = options.saibunOmitCode ? '' : `<Code>${code}</Code>`;
    const areaNode = `<Area><Name>${name}</Name>${codeNode}</Area>`;
    const extraAreaNode = options.multipleSaibunAreas
      ? '<Area><Name>伊豆諸島北部</Name><Code>130020</Code></Area>'
      : '';

    const kindName = options.saibunKindName ?? '竜巻注意情報';
    const condition = options.saibunCondition ?? '発表';

    const itemXml = `
      <Item>
        <Kind>
          <Name>${kindName}</Name>
          <Code>01</Code>
          <Condition>${condition}</Condition>
        </Kind>
        <Areas${codeTypeAttr}>
          ${areaNode}
          ${extraAreaNode}
        </Areas>
      </Item>
    `;

    saibunXml = `
      <Information type="竜巻注意情報（発表細分）">
        ${itemXml}
        ${options.multipleSaibunItems ? itemXml : ''}
      </Information>
    `;
  }

  // 2. 一次細分区域等
  const ichijiXml = options.omitIchijiInfo
    ? ''
    : `
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
  const matometaXml = options.omitMatometaInfo
    ? ''
    : `
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
  const shichosonXml = options.omitShichosonInfo
    ? ''
    : `
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
    const cond = options.sightingCondition ?? '発表';
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
          <Kind><Name>竜巻注意情報</Name><Code>01</Code><Condition>${cond}</Condition></Kind>
          ${sAreasXml}
        </Item>
      </Information>
    `;
  }

  // 6. 未知の Information@type
  let extraUnknownXml = '';
  if (options.extraUnknownInfoType) {
    extraUnknownXml = `
      <Information type="${options.extraUnknownInfoType}">
        <Item>
          <Kind><Name>竜巻注意情報</Name><Code>01</Code><Condition>発表</Condition></Kind>
          <Areas codeType="気象情報／府県予報区・細分区域等">
            <Area><Name>東京地方</Name><Code>130010</Code></Area>
          </Areas>
        </Item>
      </Information>
    `;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="${reportNs}">
  <Control>
    <Title>${controlTitle}</Title>
    <DateTime>${controlDateTime}</DateTime>
    <Status>${controlStatus}</Status>
    <EditorialOffice>気象庁本庁</EditorialOffice>
    <PublishingOffice>気象庁予報部</PublishingOffice>
  </Control>
  <Head xmlns="${headNs}">
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
      ${extraUnknownXml}
    </Headline>
  </Head>
  <Body xmlns="http://xml.kishou.go.jp/jmaxml1/body/meteorology1/">
    <Warning type="竜巻注意情報">
      <Item>
        <Kind><Name>竜巻注意情報</Name><Code>01</Code><Status>なし</Status></Kind>
        <Area><Name>伊豆諸島北部</Name><Code>130020</Code></Area>
      </Item>
      <Item>
        <Kind><Name>竜巻注意情報</Name><Code>01</Code><Status>なし</Status></Kind>
        <Area><Name>伊豆諸島南部</Name><Code>130030</Code></Area>
      </Item>
    </Warning>
  </Body>
</Report>`;
}

test('受け入れ条件 (parser・正例・実サンプル): 19_01_01_091210_VPHW50.xml のパース検証 (Body走査禁止の検証含む)', () => {
  const samplePath = join(jmaFixturesDir, '19_01_01_091210_VPHW50.xml');
  assert.ok(existsSync(samplePath), '公式サンプル 19_01_01 が存在すること');

  const xml = readFileSync(samplePath, 'utf-8');
  const expected: Pick<
    TelegramReception,
    'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
  > = {
    telegramType: 'VPHW50',
    controlStatus: 'normal',
    reportDateTime: '2009-08-09T22:38:00.000Z',
    controlDateTime: '2009-08-09T22:38:00.000Z',
  };

  const result = parseVphw(xml, expected);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const parsed = result.value;
  assert.equal(parsed.telegramType, 'VPHW50');
  assert.equal(parsed.eventId, 'VPHW50:130010');
  assert.equal(parsed.title, '東京都竜巻注意情報');
  assert.equal(parsed.informationTag, '竜巻注意情報');
  assert.equal(parsed.hasSighting, null);
  assert.equal(parsed.isCancelled, false);
  assert.equal(parsed.infoKindVersion, '1.0_0');
  assert.equal(parsed.validDateTime, '2009-08-09T23:40:00.000Z');

  // areas の検証
  // 130010, 130012, 1310800, 1311100 が含まれること
  const areaCodes = parsed.areas.map((a) => a.areaCode);
  assert.ok(areaCodes.includes('130010'), '東京地方 130010 が含まれること');
  assert.ok(areaCodes.includes('130012'), '２３区東部 130012 が含まれること');
  assert.ok(areaCodes.includes('1310800'), '江東区 1310800 が含まれること');
  assert.ok(areaCodes.includes('1311100'), '大田区 1311100 が含まれること');

  // sequence が 0 起点連番であること
  parsed.areas.forEach((a, idx) => {
    assert.equal(a.sequence, idx);
  });

  // (areaCode, codeType) の重複が無いこと
  const seen = new Set<string>();
  for (const a of parsed.areas) {
    const key = `${a.areaCode}:${a.codeType}`;
    assert.equal(seen.has(key), false, `重複キーが存在しないこと: ${key}`);
    seen.add(key);
  }

  // 130010 は発表細分と一次細分の両方に現れるが1件だけ保存されること
  const saibun130010 = parsed.areas.filter(
    (a) => a.areaCode === '130010' && a.codeType === '気象情報／府県予報区・細分区域等',
  );
  assert.equal(saibun130010.length, 1);

  // 重要: Body/Warning に Kind/Status='なし' で現れる 130020 (伊豆諸島北部) / 130030 (伊豆諸島南部) が含まれないこと
  assert.equal(
    areaCodes.includes('130020'),
    false,
    '伊豆諸島北部 130020 が areas に含まれないこと (Body走査禁止の検証)',
  );
  assert.equal(
    areaCodes.includes('130030'),
    false,
    '伊豆諸島南部 130030 が areas に含まれないこと (Body走査禁止の検証)',
  );
});

test('受け入れ条件 (parser・正例・実サンプル): 19_04_01_140425_VPHW51.xml (目撃情報ありの VPHW51)', () => {
  const samplePath = join(jmaFixturesDir, '19_04_01_140425_VPHW51.xml');
  assert.ok(existsSync(samplePath), '公式サンプル 19_04_01 が存在すること');

  const xml = readFileSync(samplePath, 'utf-8');
  const expected: Pick<
    TelegramReception,
    'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
  > = {
    telegramType: 'VPHW51',
    controlStatus: 'normal',
    reportDateTime: '2014-02-12T04:19:00.000Z',
    controlDateTime: '2014-02-12T04:19:00.000Z',
  };

  const result = parseVphw(xml, expected);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.telegramType, 'VPHW51');
  assert.equal(result.value.eventId, 'VPHW51:130010');
  assert.equal(result.value.hasSighting, true);
  assert.equal(result.value.infoKindVersion, '1.1_0');
  assert.equal(result.value.validDateTime, '2014-02-12T05:30:00.000Z');
});

test('受け入れ条件 (parser・正例・実サンプル): 19_05_01_140425_VPHW51.xml (目撃情報なしの VPHW51)', () => {
  const samplePath = join(jmaFixturesDir, '19_05_01_140425_VPHW51.xml');
  assert.ok(existsSync(samplePath), '公式サンプル 19_05_01 が存在すること');

  const xml = readFileSync(samplePath, 'utf-8');
  const expected: Pick<
    TelegramReception,
    'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
  > = {
    telegramType: 'VPHW51',
    controlStatus: 'normal',
    reportDateTime: '2014-02-12T04:36:00.000Z',
    controlDateTime: '2014-02-12T04:36:00.000Z',
  };

  const result = parseVphw(xml, expected);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.telegramType, 'VPHW51');
  assert.equal(result.value.eventId, 'VPHW51:130010');
  assert.equal(result.value.hasSighting, false);
  assert.equal(result.value.infoKindVersion, '1.1_0');
  assert.equal(result.value.validDateTime, '2014-02-12T05:50:00.000Z');
});

test('受け入れ条件 (parser・正例・実サンプル): 19_10_03_250630_VPHW50.xml (新形式Head/Title・目撃本文のVPHW50はhasSighting===null)', () => {
  const samplePath = join(jmaFixturesDir, '19_10_03_250630_VPHW50.xml');
  assert.ok(existsSync(samplePath), '公式サンプル 19_10_03 が存在すること');

  const xml = readFileSync(samplePath, 'utf-8');
  const expected: Pick<
    TelegramReception,
    'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
  > = {
    telegramType: 'VPHW50',
    controlStatus: 'normal',
    reportDateTime: '2015-07-17T00:21:00.000Z',
    controlDateTime: '2015-07-17T00:21:00.000Z',
  };

  const saitamaTarget: BosaiBulletinTarget = {
    includedAreaCodes: ['110000', '110010'],
  };

  const result = parseVphw(xml, expected, saitamaTarget);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.title, '埼玉県気象防災速報（竜巻目撃）');
  assert.equal(result.value.hasSighting, null, 'VPHW50 の目撃フラグは常に null であること');
  assert.equal(result.value.eventId, 'VPHW50:110000');
});

test('受け入れ条件 (parser・正例・実サンプル): 19_08_03_250630_VPHW50.xml (新形式 埼玉県気象防災速報（竜巻注意）)', () => {
  const samplePath = join(jmaFixturesDir, '19_08_03_250630_VPHW50.xml');
  assert.ok(existsSync(samplePath), '公式サンプル 19_08_03 が存在すること');

  const xml = readFileSync(samplePath, 'utf-8');
  const expected: Pick<
    TelegramReception,
    'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
  > = {
    telegramType: 'VPHW50',
    controlStatus: 'normal',
    reportDateTime: '2015-07-17T00:21:00.000Z',
    controlDateTime: '2015-07-17T00:21:00.000Z',
  };

  const saitamaTarget: BosaiBulletinTarget = {
    includedAreaCodes: ['110000', '110010'],
  };

  const result = parseVphw(xml, expected, saitamaTarget);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.title, '埼玉県気象防災速報（竜巻注意）');
  assert.equal(result.value.hasSighting, null);
  assert.equal(result.value.eventId, 'VPHW50:110000');
});

test('受け入れ条件 (parser・正例・実サンプル): 19_10_01_150916_VPHW50 と 19_10_02_150916_VPHW51 の対比較', () => {
  const path50 = join(jmaFixturesDir, '19_10_01_150916_VPHW50.xml');
  const path51 = join(jmaFixturesDir, '19_10_02_150916_VPHW51.xml');
  assert.ok(existsSync(path50) && existsSync(path51));

  const xml50 = readFileSync(path50, 'utf-8');
  const xml51 = readFileSync(path51, 'utf-8');

  const expected50: Pick<
    TelegramReception,
    'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
  > = {
    telegramType: 'VPHW50',
    controlStatus: 'normal',
    reportDateTime: '2015-07-17T00:21:00.000Z',
    controlDateTime: '2015-07-17T00:21:00.000Z',
  };

  const expected51: Pick<
    TelegramReception,
    'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
  > = {
    telegramType: 'VPHW51',
    controlStatus: 'normal',
    reportDateTime: '2015-07-17T00:21:00.000Z',
    controlDateTime: '2015-07-17T00:21:00.000Z',
  };

  const saitamaTarget: BosaiBulletinTarget = {
    includedAreaCodes: ['110000', '110010'],
  };

  const res50 = parseVphw(xml50, expected50, saitamaTarget);
  const res51 = parseVphw(xml51, expected51, saitamaTarget);

  assert.equal(res50.ok, true);
  assert.equal(res51.ok, true);
  if (!res50.ok || !res51.ok) return;

  assert.equal(res50.value.eventId, 'VPHW50:110000');
  assert.equal(res51.value.eventId, 'VPHW51:110000');
  assert.equal(res50.value.hasSighting, null);
  assert.equal(res51.value.hasSighting, true);
});

test('受け入れ条件 (parser・負例): 19_08_01_150916_VPHW50.xml (埼玉県) は既定targetで対象地域外となる', () => {
  const samplePath = join(jmaFixturesDir, '19_08_01_150916_VPHW50.xml');
  assert.ok(existsSync(samplePath));

  const xml = readFileSync(samplePath, 'utf-8');
  const expected: Pick<
    TelegramReception,
    'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
  > = {
    telegramType: 'VPHW50',
    controlStatus: 'normal',
    reportDateTime: '2015-07-17T00:21:00.000Z',
    controlDateTime: '2015-07-17T00:21:00.000Z',
  };

  const result = parseVphw(xml, expected);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '対象地域外');
});

test('受け入れ条件 (parser・負例): reception の telegramType が VPBS50 の場合は対象外となる', () => {
  const xml = buildVphwXml();
  const result = parseVphw(xml, {
    ...defaultExpectedVphw50,
    telegramType: 'VPBS50' as unknown as VphwTelegramType,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '対象外');
});

test('受け入れ条件 (parser・構造検証 a〜m): 合成データによる不正構造・不一致の検証', () => {
  // (a) ルート namespace 不正 -> 未対応構造
  // 公式サンプル 19_01_01 を加工した合成データ
  const resA = parseVphw(
    buildVphwXml({ reportNamespace: 'http://invalid.namespace/' }),
    defaultExpectedVphw50,
  );
  assert.equal(resA.ok, false);
  if (!resA.ok) assert.equal(resA.disposition, '未対応構造');

  // (b) Head/InfoKind が 気象解説情報 -> 対象外
  // 公式サンプル 19_01_01 を加工した合成データ
  const resB = parseVphw(buildVphwXml({ infoKind: '気象解説情報' }), defaultExpectedVphw50);
  assert.equal(resB.ok, false);
  if (!resB.ok) assert.equal(resB.disposition, '対象外');

  // (c) VPHW50 の Control/Title を 竜巻注意情報（目撃情報付き） に差し替え -> 未対応構造
  // 公式サンプル 19_01_01 を加工した合成データ
  const resC = parseVphw(
    buildVphwXml({ telegramType: 'VPHW50', controlTitle: '竜巻注意情報（目撃情報付き）' }),
    defaultExpectedVphw50,
  );
  assert.equal(resC.ok, false);
  if (!resC.ok) assert.equal(resC.disposition, '未対応構造');

  // (d) Head/ValidDateTime を削除 (InfoType='発表') -> 未対応構造
  // 公式サンプル 19_01_01 を加工した合成データ
  const resD = parseVphw(
    buildVphwXml({ infoType: '発表', omitValidDateTime: true }),
    defaultExpectedVphw50,
  );
  assert.equal(resD.ok, false);
  if (!resD.ok) assert.equal(resD.disposition, '未対応構造');

  // (e) Headline/Text を空に (InfoType='発表') -> 未対応構造
  // 公式サンプル 19_01_01 を加工した合成データ
  const resE = parseVphw(
    buildVphwXml({ infoType: '発表', omitHeadlineText: true }),
    defaultExpectedVphw50,
  );
  assert.equal(resE.ok, false);
  if (!resE.ok) assert.equal(resE.disposition, '未対応構造');

  // (f) 発表細分 Information を削除 (InfoType='発表') -> 未対応構造
  // 公式サンプル 19_01_01 を加工した合成データ
  const resF = parseVphw(
    buildVphwXml({ infoType: '発表', omitSaibunInfo: true }),
    defaultExpectedVphw50,
  );
  assert.equal(resF.ok, false);
  if (!resF.ok) assert.equal(resF.disposition, '未対応構造');

  // (g) 発表細分 Information の Item を2個に -> 未対応構造
  // 公式サンプル 19_01_01 を加工した合成データ
  const resG = parseVphw(buildVphwXml({ multipleSaibunItems: true }), defaultExpectedVphw50);
  assert.equal(resG.ok, false);
  if (!resG.ok) assert.equal(resG.disposition, '未対応構造');

  // (h) 発表細分 Information の Areas/Area を2個に -> 未対応構造
  // 公式サンプル 19_01_01 を加工した合成データ
  const resH = parseVphw(buildVphwXml({ multipleSaibunAreas: true }), defaultExpectedVphw50);
  assert.equal(resH.ok, false);
  if (!resH.ok) assert.equal(resH.disposition, '未対応構造');

  // (i) いずれかの Area/Code を削除 -> 未対応構造
  // 公式サンプル 19_01_01 を加工した合成データ
  const resI = parseVphw(buildVphwXml({ saibunOmitCode: true }), defaultExpectedVphw50);
  assert.equal(resI.ok, false);
  if (!resI.ok) assert.equal(resI.disposition, '未対応構造');

  // (j) いずれかの Areas@codeType を削除 -> 未対応構造
  // 公式サンプル 19_01_01 を加工した合成データ
  const resJ = parseVphw(buildVphwXml({ saibunOmitCodeType: true }), defaultExpectedVphw50);
  assert.equal(resJ.ok, false);
  if (!resJ.ok) assert.equal(resJ.disposition, '未対応構造');

  // (k) Information@type を既知5種以外の値 (例: 竜巻注意情報（新区分）) にした Information を追加 -> 未対応構造
  // 公式サンプル 19_01_01 を加工した合成データ
  const resK = parseVphw(
    buildVphwXml({ extraUnknownInfoType: '竜巻注意情報（新区分）' }),
    defaultExpectedVphw50,
  );
  assert.equal(resK.ok, false);
  if (!resK.ok) assert.equal(resK.disposition, '未対応構造');

  // (l) 竜巻注意情報（市町村等） Information を削除 -> 未対応構造
  // 公式サンプル 19_01_01 を加工した合成データ
  const resL = parseVphw(buildVphwXml({ omitShichosonInfo: true }), defaultExpectedVphw50);
  assert.equal(resL.ok, false);
  if (!resL.ok) assert.equal(resL.disposition, '未対応構造');

  // (m) reception と電文の値が不一致 -> 未対応構造
  // 公式サンプル 19_01_01 を加工した合成データ
  const resM1 = parseVphw(
    buildVphwXml({ controlDateTime: '2009-08-09T23:00:00Z' }),
    defaultExpectedVphw50,
  );
  assert.equal(resM1.ok, false);
  if (!resM1.ok) assert.equal(resM1.disposition, '未対応構造');

  const resM2 = parseVphw(
    buildVphwXml({ reportDateTime: '2009-08-10T10:00:00+09:00' }),
    defaultExpectedVphw50,
  );
  assert.equal(resM2.ok, false);
  if (!resM2.ok) assert.equal(resM2.disposition, '未対応構造');

  const resM3 = parseVphw(buildVphwXml({ controlStatus: '訓練' }), defaultExpectedVphw50);
  assert.equal(resM3.ok, false);
  if (!resM3.ok) assert.equal(resM3.disposition, '未対応構造');
});

test('受け入れ条件 (parser): InfoKindVersion が 1.9_0 でも受理され sourceVersion に保持される', () => {
  // 公式サンプル 19_01_01 を加工した合成データ
  const xml = buildVphwXml({ infoKindVersion: '1.9_0' });
  const result = parseVphw(xml, defaultExpectedVphw50);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.infoKindVersion, '1.9_0');
});

test('受け入れ条件 (parser): Head/EventID に値があっても合成キー VPHW50:130010 が生成される', () => {
  // 公式サンプル 19_01_01 を加工した合成データ
  const xml = buildVphwXml({ eventId: 'JPTE202309081000_1' });
  const result = parseVphw(xml, defaultExpectedVphw50);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.eventId, 'VPHW50:130010');
});

test('受け入れ条件 (parser・取消): InfoType=取消 で Text 欠落・ValidDateTime 欠落が受理され NULL となる', () => {
  // 公式サンプル 19_01_01 を加工した合成データ (実挙動未確認)
  const xml = buildVphwXml({
    infoType: '取消',
    omitHeadlineText: true,
    omitValidDateTime: true,
  });

  const result = parseVphw(xml, defaultExpectedVphw50);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.infoType, '取消');
  assert.equal(result.value.isCancelled, true);
  assert.equal(result.value.headlineText, null);
  assert.equal(result.value.validDateTime, null);
  assert.equal(result.value.eventId, 'VPHW50:130010');
});

test('受け入れ条件 (parser・取消): InfoType=取消 で発表細分が欠落した場合は代替キー VPHW50:cancel:<controlDateTime> となる', () => {
  // 公式サンプル 19_01_01 を加工した合成データ (実挙動未確認)
  const xml = buildVphwXml({
    infoType: '取消',
    omitHeadlineText: true,
    omitValidDateTime: true,
    omitSaibunInfo: true,
  });

  const result = parseVphw(xml, defaultExpectedVphw50);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.infoType, '取消');
  assert.equal(result.value.informationTag, null);
  assert.equal(result.value.eventId, 'VPHW50:cancel:2009-08-09T22:38:36.000Z');
  // 一次細分・市町村等から区域は抽出されている
  assert.ok(result.value.areas.length > 0);
});
