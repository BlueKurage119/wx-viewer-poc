import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVpbs50 } from '../src/polling/jmaVpbs50Parser.js';
import type { BosaiBulletinTarget, TelegramReception } from '../src/repositories/types.js';

const apiRoot = join(fileURLToPath(import.meta.url), '../..');
const jmaFixturesDir = join(apiRoot, 'tests/fixtures/jma');

const defaultExpectedVpbs50: Pick<
  TelegramReception,
  'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
> = {
  telegramType: 'VPBS50',
  controlStatus: 'normal',
  reportDateTime: '2026-09-10T08:00:00.000Z',
  controlDateTime: '2026-09-10T07:48:12.000Z',
};

interface BuildVpbs50XmlOptions {
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
  multipleInformationTags?: boolean;
  condition?: string;
  kindName?: string;
  headlineAreas?: Array<{
    name: string;
    code: string;
    codeType?: string;
    omitCodeType?: boolean;
    omitName?: boolean;
    omitCode?: boolean;
  }>;
  bodyAreas?: Array<{
    name: string;
    code: string;
    codeType?: string;
    omitCodeType?: boolean;
    omitName?: boolean;
    omitCode?: boolean;
  }>;
  includeBodyStation?: boolean;
  reportNamespace?: string;
  headNamespace?: string;
  bodyNamespace?: string;
  customXml?: string;
}

function buildVpbs50Xml(options: BuildVpbs50XmlOptions = {}): string {
  if (options.customXml) return options.customXml;

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
  const kindName = options.kindName ?? '情報タグ';

  const reportNs = options.reportNamespace ?? 'http://xml.kishou.go.jp/jmaxml1/';
  const headNs = options.headNamespace ?? 'http://xml.kishou.go.jp/jmaxml1/informationBasis1/';
  const bodyNs = options.bodyNamespace ?? 'http://xml.kishou.go.jp/jmaxml1/body/meteorology1/';

  const targetDtXml = options.targetDateTime
    ? `<TargetDateTime>${options.targetDateTime}</TargetDateTime>`
    : `<TargetDateTime>${reportDateTime}</TargetDateTime>`;

  let textXml = '';
  if (!options.omitHeadlineText) {
    const textContent = options.headlineText ?? '東京都東京地方では、線状降水帯が発生しました。';
    textXml = `<Text>${textContent}</Text>`;
  }

  let infoTagXml = '';
  if (!options.omitInformationTag) {
    const hlAreas = options.headlineAreas ?? [
      { name: '東京地方', code: '130010', codeType: '気象情報／府県予報区・細分区域等' },
    ];

    const areasXml = hlAreas
      .map((a) => {
        const codeTypeAttr = a.omitCodeType
          ? ''
          : ` codeType="${a.codeType ?? '気象情報／府県予報区・細分区域等'}"`;
        const nameNode = a.omitName ? '' : `<Name>${a.name}</Name>`;
        const codeNode = a.omitCode ? '' : `<Code>${a.code}</Code>`;
        return `<Areas${codeTypeAttr}><Area>${nameNode}${codeNode}</Area></Areas>`;
      })
      .join('');

    const itemXml = `
      <Item>
        <Kind>
          <Name>${kindName}</Name>
          <Condition>${condition}</Condition>
        </Kind>
        ${areasXml}
      </Item>
    `;

    infoTagXml = `
      <Information type="情報タグ">
        ${itemXml}
        ${options.multipleInformationTags ? itemXml : ''}
      </Information>
    `;
  }

  let bodyXml = '';
  const bodyAreas = options.bodyAreas ?? [];
  if (bodyAreas.length > 0 || options.includeBodyStation) {
    const bodyItemsXml = bodyAreas
      .map((a) => {
        const codeTypeAttr = a.omitCodeType
          ? ''
          : ` codeType="${a.codeType ?? '気象・地震・火山情報／市町村等'}"`;
        const nameNode = a.omitName ? '' : `<Name>${a.name}</Name>`;
        const codeNode = a.omitCode ? '' : `<Code>${a.code}</Code>`;
        return `
          <MeteorologicalInfo>
            <Item>
              <Area${codeTypeAttr}>${nameNode}${codeNode}</Area>
            </Item>
          </MeteorologicalInfo>
        `;
      })
      .join('');

    const stationXml = options.includeBodyStation
      ? `
        <MeteorologicalInfo>
          <Item>
            <Station>
              <Name>アメダス観測所</Name>
              <Code>17631</Code>
            </Station>
          </Item>
        </MeteorologicalInfo>
      `
      : '';

    bodyXml = `
      <Body xmlns="${bodyNs}">
        <MeteorologicalInfos type="観測実況">
          ${bodyItemsXml}
          ${stationXml}
        </MeteorologicalInfos>
      </Body>
    `;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="${reportNs}">
  <Control>
    <Title>${controlTitle}</Title>
    <DateTime>${controlDateTime}</DateTime>
    <Status>${controlStatus}</Status>
  </Control>
  <Head xmlns="${headNs}">
    <Title>${headTitle}</Title>
    <ReportDateTime>${reportDateTime}</ReportDateTime>
    ${targetDtXml}
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

test('受け入れ条件1: 公式サンプル 82_01_01_260324_VPBS50.xml (線状降水帯発生) のパース検証', () => {
  const samplePath = join(jmaFixturesDir, '82_01_01_260324_VPBS50.xml');
  assert.ok(existsSync(samplePath), `fixture not found: ${samplePath}`);

  const xml = readFileSync(samplePath, 'utf-8');
  const expected: Pick<
    TelegramReception,
    'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
  > = {
    telegramType: 'VPBS50',
    controlStatus: 'normal',
    reportDateTime: '2023-09-08T01:19:00.000Z',
    controlDateTime: '2023-09-08T01:19:55.000Z',
  };

  // 千葉の target を指定した場合は ok: true
  const chibaTarget: BosaiBulletinTarget = {
    includedAreaCodes: ['120010', '120020', '120030'],
  };
  const result = parseVpbs50(xml, expected, chibaTarget);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const parsed = result.value;
  assert.equal(parsed.eventId, 'JPTE202309081000_202309081019');
  assert.equal(parsed.informationTag, '線状降水帯発生');
  assert.equal(parsed.title, '千葉県気象防災速報（線状降水帯発生）');
  assert.equal(
    parsed.headlineText,
    '千葉県北西部、北東部、南部では、線状降水帯による非常に激しい雨が同じ場所で降り続いています。命に危険が及ぶ災害発生の危険度が急激に高まっています。',
  );
  assert.equal(parsed.isCancelled, false);
  assert.equal(parsed.infoKindVersion, '1.5_0');
  assert.equal(parsed.areas.length, 3);
  assert.deepEqual(parsed.areas, [
    {
      areaCode: '120010',
      areaName: '北西部',
      codeType: '気象情報／府県予報区・細分区域等',
      sequence: 0,
    },
    {
      areaCode: '120020',
      areaName: '北東部',
      codeType: '気象情報／府県予報区・細分区域等',
      sequence: 1,
    },
    {
      areaCode: '120030',
      areaName: '南部',
      codeType: '気象情報／府県予報区・細分区域等',
      sequence: 2,
    },
  ]);

  // 既定 target (東京) の場合は対象地域外
  const defaultResult = parseVpbs50(xml, expected);
  assert.equal(defaultResult.ok, false);
  if (defaultResult.ok) return;
  assert.equal(defaultResult.disposition, '対象地域外');
});

test('受け入れ条件2: 公式サンプル 82_01_02_250630_VPBS50.xml (記録的短時間大雨) のパース検証 (Headline と Body の両方抽出、Station 除外)', () => {
  const samplePath = join(jmaFixturesDir, '82_01_02_250630_VPBS50.xml');
  assert.ok(existsSync(samplePath), `fixture not found: ${samplePath}`);

  const xml = readFileSync(samplePath, 'utf-8');
  const expected: Pick<
    TelegramReception,
    'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
  > = {
    telegramType: 'VPBS50',
    controlStatus: 'normal',
    reportDateTime: '2023-07-13T04:29:26.000Z',
    controlDateTime: '2023-07-13T04:29:26.000Z',
  };

  const abashiriTarget: BosaiBulletinTarget = {
    includedAreaCodes: ['013010', '0154300'],
  };
  const result = parseVpbs50(xml, expected, abashiriTarget);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const parsed = result.value;
  assert.equal(parsed.eventId, 'JPSB202307131329_202307131329');
  assert.equal(parsed.informationTag, '記録雨');
  assert.equal(parsed.title, '網走・北見・紋別地方気象防災速報（記録的短時間大雨）');
  assert.equal(parsed.areas.length, 2);
  assert.deepEqual(parsed.areas, [
    {
      areaCode: '013010',
      areaName: '網走地方',
      codeType: '気象情報／府県予報区・細分区域等',
      sequence: 0,
    },
    {
      areaCode: '0154300',
      areaName: '美幌町',
      codeType: '気象・地震・火山情報／市町村等',
      sequence: 1,
    },
  ]);
});

test('受け入れ条件3: 負例実データ 20260905220832_0_VPBS50_130000.xml (伊豆諸島南部 130030) は既定 target で対象地域外となる', () => {
  const fixturePath = join(jmaFixturesDir, '20260905220832_0_VPBS50_130000.xml');
  assert.ok(existsSync(fixturePath), '実データ負例 fixture が存在すること');

  const xml = readFileSync(fixturePath, 'utf-8');
  const expected: Pick<
    TelegramReception,
    'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
  > = {
    telegramType: 'VPBS50',
    controlStatus: 'normal',
    reportDateTime: '2026-09-05T22:08:00.000Z',
    controlDateTime: '2026-09-05T22:08:31.000Z',
  };

  // 既定 target (東京23区・東京地方) では対象地域外
  const result = parseVpbs50(xml, expected);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '対象地域外');

  // 伊豆諸島南部 (130030) を含む target なら ok: true
  const izuTarget: BosaiBulletinTarget = { includedAreaCodes: ['130030'] };
  const izuResult = parseVpbs50(xml, expected, izuTarget);
  assert.equal(izuResult.ok, true);
  if (!izuResult.ok) return;
  assert.equal(izuResult.value.eventId, 'YJPTK202609060708_202609060708');
  assert.equal(izuResult.value.informationTag, '線状降水帯直前');
});

test('受け入れ条件5: 短時間大雪 (82_01_03_241031_VPBS50.xml) は対象外となる', () => {
  const samplePath = join(jmaFixturesDir, '82_01_03_241031_VPBS50.xml');
  assert.ok(existsSync(samplePath), `fixture not found: ${samplePath}`);

  const xml = readFileSync(samplePath, 'utf-8');
  const expected: Pick<
    TelegramReception,
    'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
  > = {
    telegramType: 'VPBS50',
    controlStatus: 'normal',
    reportDateTime: '2024-01-23T21:13:13.000Z',
    controlDateTime: '2024-01-23T21:13:13.000Z',
  };

  const target: BosaiBulletinTarget = { includedAreaCodes: ['250000', '1310800'] };
  const result = parseVpbs50(xml, expected, target);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '対象外');
});

test('短時間大雪 (合成 fixture): 区域が東京対象コードであっても対象外となる', () => {
  // 公式サンプル 82_01_03_241031_VPBS50.xml の区域を東京に差し替えた合成データ
  const xml = buildVpbs50Xml({
    condition: '短時間大雪',
    headlineAreas: [
      { name: '江東区', code: '1310800', codeType: '気象・地震・火山情報／市町村等' },
    ],
  });

  const result = parseVpbs50(xml, defaultExpectedVpbs50);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.disposition, '対象外');
});

test('受け入れ条件6: 公式サンプル 82_03_01/02/03_260324_VPBS50.xml (同一親番・枝番違い3件) のパース検証', () => {
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

  for (const s of samples) {
    const samplePath = join(jmaFixturesDir, s.file);
    assert.ok(existsSync(samplePath), `fixture not found: ${samplePath}`);

    const xml = readFileSync(samplePath, 'utf-8');
    const expected: Pick<
      TelegramReception,
      'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
    > = {
      telegramType: 'VPBS50',
      controlStatus: 'normal',
      reportDateTime: s.reportDt,
      controlDateTime: s.ctrlDt,
    };

    const result = parseVpbs50(xml, expected, fukuokaTarget);
    assert.equal(result.ok, true);
    if (!result.ok) continue;

    assert.equal(result.value.eventId, s.expectedEventId);
    assert.equal(result.value.informationTag, '線状降水帯直前');
  }
});

test('受け入れ条件13: InfoType=取消 かつ Headline/Text 欠落 / 情報タグ Item 0件が受理され NULL となる', () => {
  // 合成データ: 取消電文で Text 欠落かつ Information タグ欠落、Body に江東区 1310800
  const xml = buildVpbs50Xml({
    infoType: '取消',
    omitHeadlineText: true,
    omitInformationTag: true,
    bodyAreas: [{ name: '江東区', code: '1310800', codeType: '気象・地震・火山情報／市町村等' }],
  });

  const result = parseVpbs50(xml, defaultExpectedVpbs50);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.infoType, '取消');
  assert.equal(result.value.isCancelled, true);
  assert.equal(result.value.headlineText, null);
  assert.equal(result.value.informationTag, null);
  assert.equal(result.value.areas.length, 1);
  assert.equal(result.value.areas[0]!.areaCode, '1310800');
});

test('受け入れ条件14: InfoType=発表 / 訂正 では Headline/Text 欠落・情報タグ欠落は未対応構造として拒否される', () => {
  // 発表電文で Headline/Text 欠落
  const xml1 = buildVpbs50Xml({
    infoType: '発表',
    omitHeadlineText: true,
  });
  const result1 = parseVpbs50(xml1, defaultExpectedVpbs50);
  assert.equal(result1.ok, false);
  if (!result1.ok) assert.equal(result1.disposition, '未対応構造');

  // 訂正電文で情報タグ欠落
  const xml2 = buildVpbs50Xml({
    infoType: '訂正',
    omitInformationTag: true,
    bodyAreas: [{ name: '江東区', code: '1310800', codeType: '気象・地震・火山情報／市町村等' }],
  });
  const result2 = parseVpbs50(xml2, defaultExpectedVpbs50);
  assert.equal(result2.ok, false);
  if (!result2.ok) assert.equal(result2.disposition, '未対応構造');
});

test('受け入れ条件15: InfoType=取消 で情報タグがなく抽出区域が0件の場合は未対応構造となる', () => {
  const xml = buildVpbs50Xml({
    infoType: '取消',
    omitHeadlineText: true,
    omitInformationTag: true,
    bodyAreas: [],
  });
  const result = parseVpbs50(xml, defaultExpectedVpbs50);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.disposition, '未対応構造');
  }
});

test('受け入れ条件15-2: InfoType=取消 で区域が対象外の場合は対象地域外となる', () => {
  const xml = buildVpbs50Xml({
    infoType: '取消',
    omitHeadlineText: true,
    omitInformationTag: true,
    bodyAreas: [
      { name: '伊豆諸島南部', code: '130030', codeType: '気象情報／府県予報区・細分区域等' },
    ],
  });
  const result = parseVpbs50(xml, defaultExpectedVpbs50);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.disposition, '対象地域外');
  }
});

test('受け入れ条件17: 各種不正構造・不一致の検証', () => {
  // 1. 電文種別不一致
  const res1 = parseVpbs50(buildVpbs50Xml(), {
    ...defaultExpectedVpbs50,
    telegramType: 'VPFD51',
  });
  assert.equal(res1.ok, false);
  if (!res1.ok) assert.equal(res1.disposition, '対象外');

  // 2. Control/Title 不正
  const res2 = parseVpbs50(buildVpbs50Xml({ controlTitle: '警報注意報' }), defaultExpectedVpbs50);
  assert.equal(res2.ok, false);
  if (!res2.ok) assert.equal(res2.disposition, '対象外');

  // 3. Head/InfoKind 不正
  const res3 = parseVpbs50(buildVpbs50Xml({ infoKind: '気象警報・注意報' }), defaultExpectedVpbs50);
  assert.equal(res3.ok, false);
  if (!res3.ok) assert.equal(res3.disposition, '対象外');

  // 4. 未知の Condition
  const res4 = parseVpbs50(buildVpbs50Xml({ condition: '未知の速報種別' }), defaultExpectedVpbs50);
  assert.equal(res4.ok, false);
  if (!res4.ok) assert.equal(res4.disposition, '対象外');

  // 5. Kind/Name 不正
  const res5 = parseVpbs50(buildVpbs50Xml({ kindName: '不正タグ' }), defaultExpectedVpbs50);
  assert.equal(res5.ok, false);
  if (!res5.ok) assert.equal(res5.disposition, '未対応構造');

  // 6. Control/Status 不一致
  const res6 = parseVpbs50(buildVpbs50Xml({ controlStatus: '訓練' }), defaultExpectedVpbs50);
  assert.equal(res6.ok, false);
  if (!res6.ok) assert.equal(res6.disposition, '未対応構造');

  // 7. Control/DateTime 不一致
  const res7 = parseVpbs50(
    buildVpbs50Xml({ controlDateTime: '2026-09-10T12:00:00Z' }),
    defaultExpectedVpbs50,
  );
  assert.equal(res7.ok, false);
  if (!res7.ok) assert.equal(res7.disposition, '未対応構造');

  // 8. Head/ReportDateTime 不一致
  const res8 = parseVpbs50(
    buildVpbs50Xml({ reportDateTime: '2026-09-10T19:00:00+09:00' }),
    defaultExpectedVpbs50,
  );
  assert.equal(res8.ok, false);
  if (!res8.ok) assert.equal(res8.disposition, '未対応構造');

  // 9. Area/Code 欠落
  const res9 = parseVpbs50(
    buildVpbs50Xml({ headlineAreas: [{ name: '東京地方', code: '', omitCode: true }] }),
    defaultExpectedVpbs50,
  );
  assert.equal(res9.ok, false);
  if (!res9.ok) assert.equal(res9.disposition, '未対応構造');

  // 10. Areas@codeType 欠落
  const res10 = parseVpbs50(
    buildVpbs50Xml({ headlineAreas: [{ name: '東京地方', code: '130010', omitCodeType: true }] }),
    defaultExpectedVpbs50,
  );
  assert.equal(res10.ok, false);
  if (!res10.ok) assert.equal(res10.disposition, '未対応構造');

  // 11. 情報タグ Item が複数
  const res11 = parseVpbs50(
    buildVpbs50Xml({ multipleInformationTags: true }),
    defaultExpectedVpbs50,
  );
  assert.equal(res11.ok, false);
  if (!res11.ok) assert.equal(res11.disposition, '未対応構造');

  // 12. Report namespace 不正
  const res12 = parseVpbs50(
    buildVpbs50Xml({ reportNamespace: 'http://invalid.namespace/' }),
    defaultExpectedVpbs50,
  );
  assert.equal(res12.ok, false);
  if (!res12.ok) assert.equal(res12.disposition, '未対応構造');
});

test('受け入れ条件18: InfoKindVersion が 1.5_0 以外の値 (例 1.6_0) でも受理される', () => {
  const xml = buildVpbs50Xml({
    infoKindVersion: '1.6_0',
  });
  const result = parseVpbs50(xml, defaultExpectedVpbs50);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.infoKindVersion, '1.6_0');
});

test('区域重複除去: Headline と Body で同じ (areaCode, codeType) がある場合は1件に重複除去される', () => {
  const xml = buildVpbs50Xml({
    headlineAreas: [
      { name: '東京地方', code: '130010', codeType: '気象情報／府県予報区・細分区域等' },
    ],
    bodyAreas: [
      { name: '東京地方', code: '130010', codeType: '気象情報／府県予報区・細分区域等' },
      { name: '江東区', code: '1310800', codeType: '気象・地震・火山情報／市町村等' },
    ],
  });

  const result = parseVpbs50(xml, defaultExpectedVpbs50);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.areas.length, 2);
  assert.deepEqual(result.value.areas, [
    {
      areaCode: '130010',
      areaName: '東京地方',
      codeType: '気象情報／府県予報区・細分区域等',
      sequence: 0,
    },
    {
      areaCode: '1310800',
      areaName: '江東区',
      codeType: '気象・地震・火山情報／市町村等',
      sequence: 1,
    },
  ]);
});
