import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TRAINING_ITEMS,
  parseTrainingItemIds,
  type TrainingItemId,
  type TrainingTelegramType,
} from '@wx-viewer-poc/shared';
import { parseVphw } from '../src/polling/jmaVphwParser.js';
import { parseVpbs50 } from '../src/polling/jmaVpbs50Parser.js';
import { parseWarningTelegram } from '../src/polling/jmaWarningTelegramParser.js';
import { generateTrainingTelegrams } from '../src/training/trainingTelegramGenerator.js';
import { el, serializeXml, xmlEscape } from '../src/training/trainingXmlBuilder.js';
import {
  NS_EB,
  jstString,
  kids,
  parseXml,
  path,
  text,
  textAt,
} from './helpers/trainingTelegramXml.js';

const GENERATION_ID = '123e4567-e89b-42d3-a456-426614174000';
/** 受け入れ条件の固定時計。JST 2026-10-11 23:59:45。 */
const NOW = '2026-10-11T14:59:45.000Z';

function generate(itemIds: readonly string[], now = NOW, generationId = GENERATION_ID) {
  return generateTrainingTelegrams(itemIds as TrainingItemId[], { now, generationId });
}

function single(itemId: string, now = NOW) {
  const result = generate([itemId], now);
  assert.equal(result.length, 1);
  return result[0]!;
}

// 独立した期待表（生成定義から作らず、設計書の項目表・別表3/5から手書きしたもの）。
interface WarningExpectation {
  readonly itemId: string;
  readonly name: string;
  readonly telegram: TrainingTelegramType;
  readonly controlSuffix: string;
  readonly headTitle: string;
  readonly risk: string;
  readonly sigName: string;
  readonly sigCode: string;
  readonly properties: readonly string[];
}

function w(
  itemId: string,
  name: string,
  telegram: TrainingTelegramType,
  controlSuffix: string,
  headTitle: string,
  risk: string,
  sig: readonly [string, string],
  properties?: readonly string[],
): WarningExpectation {
  return {
    itemId,
    name,
    telegram,
    controlSuffix,
    headTitle,
    risk,
    sigName: sig[0],
    sigCode: sig[1],
    properties: properties ?? [risk],
  };
}

const L2 = ['警戒レベル２', '21'] as const;
const L3 = ['警戒レベル３相当', '31'] as const;
const L4 = ['警戒レベル４相当', '41'] as const;
const L5 = ['警戒レベル５相当', '51'] as const;
const ADV = ['注意報級', '20'] as const;
const WARN = ['警報級', '30'] as const;
const SPEC = ['特別警報級', '50'] as const;
const SURGE_PROPS = ['高潮危険度', '高潮基準超過', '高潮ピーク'];

const WARNING_EXPECTATIONS: readonly WarningExpectation[] = [
  w(
    'warning-10',
    'レベル２大雨注意報',
    'VPWW55',
    '大雨',
    '東京都大雨警報・注意報',
    '大雨浸水危険度',
    L2,
  ),
  w(
    'warning-03',
    'レベル３大雨警報',
    'VPWW55',
    '大雨',
    '東京都大雨警報・注意報',
    '大雨浸水危険度',
    L3,
  ),
  w(
    'warning-43',
    'レベル４大雨危険警報',
    'VPWW55',
    '大雨',
    '東京都大雨警報・注意報',
    '大雨浸水危険度',
    L4,
  ),
  w(
    'warning-33',
    'レベル５大雨特別警報',
    'VPWW55',
    '大雨',
    '東京都大雨警報・注意報',
    '大雨浸水危険度',
    L5,
  ),
  w(
    'warning-29',
    'レベル２土砂災害注意報',
    'VPWW56',
    '土砂',
    '東京都土砂災害警報・注意報',
    '土砂災害危険度',
    L2,
  ),
  w(
    'warning-19',
    'レベル２高潮注意報',
    'VPWW57',
    '高潮',
    '東京都高潮警報・注意報',
    '高潮危険度',
    L2,
    SURGE_PROPS,
  ),
  w(
    'warning-08',
    'レベル３高潮警報',
    'VPWW57',
    '高潮',
    '東京都高潮警報・注意報',
    '高潮危険度',
    L3,
    SURGE_PROPS,
  ),
  w(
    'warning-48',
    'レベル４高潮危険警報',
    'VPWW57',
    '高潮',
    '東京都高潮警報・注意報',
    '高潮危険度',
    L4,
    SURGE_PROPS,
  ),
  w(
    'warning-38',
    'レベル５高潮特別警報',
    'VPWW57',
    '高潮',
    '東京都高潮警報・注意報',
    '高潮危険度',
    L5,
    SURGE_PROPS,
  ),
  w('warning-15', '強風注意報', 'VPWW58', '暴風', '東京都暴風警報・注意報', '風危険度', ADV, [
    '風危険度',
    '風',
  ]),
  w('warning-05', '暴風警報', 'VPWW58', '暴風', '東京都暴風警報・注意報', '風危険度', WARN, [
    '風危険度',
    '風',
  ]),
  w('warning-35', '暴風特別警報', 'VPWW58', '暴風', '東京都暴風警報・注意報', '風危険度', SPEC, [
    '風危険度',
    '風',
  ]),
  w('warning-13', '風雪注意報', 'VPWW58', '暴風', '東京都暴風警報・注意報', '風危険度', ADV, [
    '風危険度',
    '風',
  ]),
  w('warning-02', '暴風雪警報', 'VPWW58', '暴風', '東京都暴風警報・注意報', '風危険度', WARN, [
    '風危険度',
    '風',
  ]),
  w('warning-32', '暴風雪特別警報', 'VPWW58', '暴風', '東京都暴風警報・注意報', '風危険度', SPEC, [
    '風危険度',
    '風',
  ]),
  w('warning-16', '波浪注意報', 'VPWW59', '波浪', '東京都波浪警報・注意報', '波危険度', ADV, [
    '波危険度',
    '波',
  ]),
  w('warning-07', '波浪警報', 'VPWW59', '波浪', '東京都波浪警報・注意報', '波危険度', WARN, [
    '波危険度',
    '波',
  ]),
  w('warning-37', '波浪特別警報', 'VPWW59', '波浪', '東京都波浪警報・注意報', '波危険度', SPEC, [
    '波危険度',
    '波',
  ]),
  w('warning-12', '大雪注意報', 'VPWW60', '大雪', '東京都大雪警報・注意報', '雪危険度', ADV, [
    '雪危険度',
    '雪',
  ]),
  w('warning-06', '大雪警報', 'VPWW60', '大雪', '東京都大雪警報・注意報', '雪危険度', WARN, [
    '雪危険度',
    '雪',
  ]),
  w('warning-36', '大雪特別警報', 'VPWW60', '大雪', '東京都大雪警報・注意報', '雪危険度', SPEC, [
    '雪危険度',
    '雪',
  ]),
  w('warning-14', '雷注意報', 'VPWW61', 'その他注意報', '東京都雷注意報', '雷危険度', ADV),
  w('warning-20', '濃霧注意報', 'VPWW61', 'その他注意報', '東京都濃霧注意報', '濃霧危険度', ADV, [
    '濃霧危険度',
    '濃霧',
  ]),
  w('warning-21', '乾燥注意報', 'VPWW61', 'その他注意報', '東京都乾燥注意報', '乾燥危険度', ADV, [
    '乾燥危険度',
    '乾燥',
  ]),
  w('warning-23', '低温注意報', 'VPWW61', 'その他注意報', '東京都低温注意報', '低温危険度', ADV),
  w('warning-24', '霜注意報', 'VPWW61', 'その他注意報', '東京都霜注意報', '霜危険度', ADV),
  w('warning-25', '着氷注意報', 'VPWW61', 'その他注意報', '東京都着氷注意報', '着氷危険度', ADV),
  w('warning-26', '着雪注意報', 'VPWW61', 'その他注意報', '東京都着雪注意報', '着雪危険度', ADV),
];

const BANNER = '＊＊＊これは訓練です＊＊＊\n';
/** 公式サンプル（15_16_01〜08・15_17_01）の文型に合わせた Headline/Text 本文の独立した期待表。 */
const WARNING_HEADLINES: Readonly<Record<string, string>> = {
  'warning-10': '東京都では、低い土地の浸水や河川の増水に注意してください。',
  'warning-03': '東京都では、低い土地の浸水や河川の増水に警戒してください。',
  'warning-43':
    '東京都にレベル４大雨危険警報を発表しています。低い土地の浸水や川の増水に厳重に警戒をしてください。',
  'warning-33':
    '【特別警報（大雨）】東京都に特別警報を発表しています。土砂災害や低い土地の浸水、河川の増水に最大級の警戒をしてください。',
  'warning-29': '東京都では、土砂災害に注意してください。',
  'warning-19': '東京都では、高潮に注意してください。',
  'warning-08': '東京都では、高潮に警戒してください。',
  'warning-48':
    '東京都にレベル４高潮危険警報を発表しています。１２日５時５９分以降に、水位が堤防を超えるおそれがあります。',
  'warning-38':
    '【特別警報（高潮）】東京都に特別警報を発表しています。高潮に最大級の警戒をしてください。',
  'warning-15': '東京都では、強風に注意してください。',
  'warning-05': '東京都では、暴風に警戒してください。',
  'warning-35':
    '【特別警報（暴風）】東京都に特別警報を発表しています。暴風に最大級の警戒をしてください。',
  'warning-13': '東京都では、風雪に注意してください。',
  'warning-02': '東京都では、暴風雪に警戒してください。',
  'warning-32':
    '【特別警報（暴風雪）】東京都に特別警報を発表しています。暴風雪に最大級の警戒をしてください。',
  'warning-16': '東京都では、高波に注意してください。',
  'warning-07': '東京都では、高波に警戒してください。',
  'warning-37':
    '【特別警報（波浪）】東京都に特別警報を発表しています。高波に最大級の警戒をしてください。',
  'warning-12': '東京都では、大雪に注意してください。',
  'warning-06': '東京都では、大雪に警戒してください。',
  'warning-36':
    '【特別警報（大雪）】東京都に特別警報を発表しています。大雪に最大級の警戒をしてください。',
  'warning-14': '東京都では、急な強い雨や落雷に注意してください。',
  'warning-20': '東京都では、濃い霧に注意してください。',
  'warning-21': '東京都では、空気の乾燥に注意してください。',
  'warning-23': '東京都では、低温に注意してください。',
  'warning-24': '東京都では、霜に注意してください。',
  'warning-25': '東京都では、着氷に注意してください。',
  'warning-26': '東京都では、着雪に注意してください。',
};

const TIERS = [
  ['気象警報・注意報（府県予報区等）', '東京都', '130000', '気象情報／府県予報区・細分区域等'],
  ['気象警報・注意報（一次細分区域等）', '東京地方', '130010', '気象情報／府県予報区・細分区域等'],
  [
    '気象警報・注意報（市町村等をまとめた地域等）',
    '２３区東部',
    '130012',
    '気象情報／府県予報区・細分区域等',
  ],
  ['気象警報・注意報（市町村等）', '江東区', '1310800', '気象・地震・火山情報／市町村等'],
] as const;

const REPORT_JST = '2026-10-11T23:59:00+09:00';

test('項目表の選択可能項目は期待表と1対1に一致する', () => {
  const selectable = TRAINING_ITEMS.filter((item) => item.selectable).map((item) => item.id);
  const expected = [
    ...WARNING_EXPECTATIONS.map((row) => row.itemId),
    'bulletin-linear-occurrence',
    'bulletin-linear-imminent',
    'bulletin-record-rain',
    'bulletin-tornado',
    'bulletin-tornado-observed',
  ];
  assert.deepEqual([...selectable].sort(), [...expected].sort());
  const unavailable = TRAINING_ITEMS.filter((item) => !item.selectable).map((item) => item.id);
  assert.deepEqual(
    [...unavailable].sort(),
    ['warning-09', 'warning-49', 'warning-39', 'warning-17', 'warning-22'].sort(),
  );
});

for (const expected of WARNING_EXPECTATIONS) {
  test(`警報・注意報 ${expected.itemId} ${expected.name}: 種別・名称・コード・区域・Property`, () => {
    const telegram = single(expected.itemId);
    assert.equal(telegram.telegramType, expected.telegram);
    assert.equal(telegram.title, expected.headTitle);
    assert.deepEqual([...telegram.itemIds], [expected.itemId]);
    const root = parseXml(telegram.xml);
    // Control
    assert.equal(
      textAt(root, 'Control', 'Title'),
      `気象警報・注意報（Ｒ０６）（${expected.controlSuffix}）`,
    );
    assert.equal(textAt(root, 'Control', 'Status'), '訓練');
    assert.equal(textAt(root, 'Control', 'DateTime'), '2026-10-11T14:59:45Z');
    assert.equal(textAt(root, 'Control', 'EditorialOffice'), '気象庁');
    assert.equal(textAt(root, 'Control', 'PublishingOffice'), '気象庁');
    // Head
    assert.equal(textAt(root, 'Head', 'Title'), expected.headTitle);
    assert.equal(textAt(root, 'Head', 'ReportDateTime'), REPORT_JST);
    assert.equal(textAt(root, 'Head', 'TargetDateTime'), REPORT_JST);
    assert.equal(textAt(root, 'Head', 'EventID'), '');
    assert.equal(textAt(root, 'Head', 'Serial'), '');
    assert.equal(textAt(root, 'Head', 'InfoType'), '発表');
    assert.equal(textAt(root, 'Head', 'InfoKind'), '気象警報・注意報');
    assert.equal(textAt(root, 'Head', 'InfoKindVersion'), '1.5_0');
    assert.equal(path(root, 'Head', 'ValidDateTime').length, 0);
    assert.equal(
      textAt(root, 'Head', 'Headline', 'Text'),
      BANNER + WARNING_HEADLINES[expected.itemId],
    );
    // Headline/Information の4層
    const informations = path(root, 'Head', 'Headline', 'Information');
    assert.equal(informations.length, 4);
    informations.forEach((information, index) => {
      const [type, areaName, areaCode, codeType] = TIERS[index]!;
      assert.equal(information.getAttribute('type'), type);
      const kindsOfItem = path(information, 'Item', 'Kind');
      assert.equal(kindsOfItem.length, 1);
      assert.equal(textAt(kindsOfItem[0]!, 'Name'), expected.name);
      assert.equal(textAt(kindsOfItem[0]!, 'Code'), expected.itemId.replace('warning-', ''));
      const areas = path(information, 'Item', 'Areas');
      assert.equal(areas[0]!.getAttribute('codeType'), codeType);
      assert.equal(textAt(areas[0]!, 'Area', 'Name'), areaName);
      assert.equal(textAt(areas[0]!, 'Area', 'Code'), areaCode);
    });
    // Body/Warning の4層
    const warnings = path(root, 'Body', 'Warning');
    assert.equal(warnings.length, 4);
    warnings.forEach((warning, index) => {
      const [type, areaName, areaCode] = TIERS[index]!;
      assert.equal(warning.getAttribute('type'), type);
      const items = path(warning, 'Item');
      assert.equal(items.length, 1);
      const item = items[0]!;
      assert.deepEqual(
        kids(item).map((child) => child.localName),
        index < 3
          ? ['Kind', 'Area', 'ChangeStatus', 'FullStatus', 'EditingMark']
          : ['Kind', 'Area', 'ChangeStatus'],
      );
      const kind = path(item, 'Kind')[0]!;
      assert.equal(textAt(kind, 'Name'), expected.name);
      assert.equal(textAt(kind, 'Code'), expected.itemId.replace('warning-', ''));
      assert.equal(textAt(kind, 'Status'), '発表');
      assert.equal(path(kind, 'LastKind').length, 0);
      assert.equal(path(kind, 'NextKinds').length, 0);
      assert.equal(path(kind, 'DateTime').length, 0);
      assert.equal(textAt(item, 'Area', 'Name'), areaName);
      assert.equal(textAt(item, 'Area', 'Code'), areaCode);
      assert.equal(textAt(item, 'ChangeStatus'), '警報・注意報種別に変化有');
      if (index < 3) {
        assert.equal(textAt(item, 'FullStatus'), '一部');
        assert.equal(textAt(item, 'EditingMark'), '0');
        assert.equal(path(kind, 'Property').length, 0);
      } else {
        const properties = path(kind, 'Property');
        assert.deepEqual(
          properties.map((property) => textAt(property, 'Type')),
          expected.properties,
        );
        // 危険度: Type と Significancy@type は同じ文字列、直下に Name/Code
        const significancy = path(properties[0]!, 'SignificancyPart', 'Base', 'Significancy')[0]!;
        assert.equal(significancy.getAttribute('type'), expected.risk);
        assert.equal(textAt(significancy, 'Name'), expected.sigName);
        assert.equal(textAt(significancy, 'Code'), expected.sigCode);
      }
    });
  });
}

test('Kind/Code と Significancy/Code は独立した値（43→41、35→50）', () => {
  const rain = parseXml(single('warning-43').xml);
  const rainKind = path(rain, 'Body', 'Warning')[3]!;
  assert.equal(textAt(rainKind, 'Item', 'Kind', 'Code'), '43');
  assert.equal(
    textAt(
      rainKind,
      'Item',
      'Kind',
      'Property',
      'SignificancyPart',
      'Base',
      'Significancy',
      'Code',
    ),
    '41',
  );
  const wind = parseXml(single('warning-35').xml);
  const windKind = path(wind, 'Body', 'Warning')[3]!;
  assert.equal(textAt(windKind, 'Item', 'Kind', 'Code'), '35');
  assert.equal(
    textAt(
      windKind,
      'Item',
      'Kind',
      'Property',
      'SignificancyPart',
      'Base',
      'Significancy',
      'Code',
    ),
    '50',
  );
});

function quantityOf(itemId: string, localName: string) {
  const root = parseXml(single(itemId).xml);
  const found = root.getElementsByTagNameNS(NS_EB, localName);
  return Array.from({ length: found.length }, (_, index) => found.item(index)!);
}

test('風・雪・波・濃霧・乾燥の量Property（値・単位・属性）', () => {
  const windRows: [string, string, string, string, string][] = [
    // itemId, 風向, 風速, 風速description, condition
    ['warning-15', '南', '15', '１５メートル', ''],
    ['warning-05', '南', '30', '３０メートル', ''],
    ['warning-35', '南', '50', '５０メートル', ''],
    ['warning-13', '北', '15', '１５メートル', '風雪'],
    ['warning-02', '北', '30', '３０メートル', '風雪'],
    ['warning-32', '北', '50', '５０メートル', '風雪'],
  ];
  for (const [itemId, direction, speed, description, condition] of windRows) {
    const [dir] = quantityOf(itemId, 'WindDirection');
    assert.equal(text(dir), direction, itemId);
    assert.equal(dir!.getAttribute('type'), '風向');
    assert.equal(dir!.getAttribute('unit'), '８方位漢字');
    assert.equal(dir!.getAttribute('condition') ?? '', condition);
    const [spd] = quantityOf(itemId, 'WindSpeed');
    assert.equal(text(spd), speed, itemId);
    assert.equal(spd!.getAttribute('type'), '最大風速');
    assert.equal(spd!.getAttribute('unit'), 'm/s');
    assert.equal(spd!.getAttribute('description'), description);
  }
  const snowRows: [string, string, string][] = [
    ['warning-12', '5', '５センチ'],
    ['warning-06', '15', '１５センチ'],
    ['warning-36', '50', '５０センチ'],
  ];
  for (const [itemId, value, description] of snowRows) {
    const [depth] = quantityOf(itemId, 'SnowfallDepth');
    assert.equal(text(depth), value);
    assert.equal(depth!.getAttribute('type'), '１２時間最大降雪量');
    assert.equal(depth!.getAttribute('unit'), 'cm');
    assert.equal(depth!.getAttribute('description'), description);
  }
  const waveRows: [string, string, string][] = [
    ['warning-16', '2', '２メートル'],
    ['warning-07', '4', '４メートル'],
    ['warning-37', '8', '８メートル'],
  ];
  for (const [itemId, value, description] of waveRows) {
    const [height] = quantityOf(itemId, 'WaveHeight');
    assert.equal(text(height), value);
    assert.equal(height!.getAttribute('type'), '波高');
    assert.equal(height!.getAttribute('unit'), 'm');
    assert.equal(height!.getAttribute('description'), description);
  }
  const [visibility] = quantityOf('warning-20', 'Visibility');
  assert.equal(text(visibility), '100');
  assert.equal(visibility!.getAttribute('type'), '視程');
  assert.equal(visibility!.getAttribute('unit'), 'm');
  assert.equal(visibility!.getAttribute('condition'), '以下');
  const humidity = quantityOf('warning-21', 'Humidity');
  assert.deepEqual(
    humidity.map((node) => [node.getAttribute('type'), text(node), node.getAttribute('unit')]),
    [
      ['実効湿度', '40', '%'],
      ['最小湿度', '20', '%'],
    ],
  );
  // 乾燥はHumidityPartが2つ、それぞれBaseにHumidity1つ
  const dryKind = path(parseXml(single('warning-21').xml), 'Body', 'Warning')[3]!;
  const dryProperty = path(dryKind, 'Item', 'Kind', 'Property')[1]!;
  assert.equal(path(dryProperty, 'HumidityPart').length, 2);
});

test('霜: PeakTime が T+24h のJST日付と3時間帯、高潮ではPeakTimeを作らない', () => {
  // T=JST 2026-10-11 23:59 → T+24h=10/12 23:59 → 夜遅く
  const frost = parseXml(single('warning-24').xml);
  const base = path(
    path(frost, 'Body', 'Warning')[3]!,
    'Item',
    'Kind',
    'Property',
    'SignificancyPart',
    'Base',
  )[0]!;
  assert.equal(textAt(base, 'PeakTime', 'Date'), '１２日');
  assert.equal(textAt(base, 'PeakTime', 'Term'), '夜遅く');
  assert.equal(
    kids(base)
      .map((node) => node.localName)
      .join(','),
    'Significancy,PeakTime',
  );
  const terms: [string, string, string][] = [
    // now(UTC), 期待Date, 期待Term（T+24hのJST時刻の3時間帯）
    ['2026-10-11T15:05:00.000Z', '１３日', '未明'], // JST 10/12 00:05 → +24h 10/13 00:05
    ['2026-10-11T18:00:00.000Z', '１３日', '明け方'], // JST 03:00
    ['2026-10-11T21:30:00.000Z', '１３日', '朝'], // JST 06:30
    ['2026-10-12T00:59:00.000Z', '１３日', '昼前'], // JST 09:59
    ['2026-10-12T03:00:00.000Z', '１３日', '昼過ぎ'], // JST 12:00
    ['2026-10-12T06:00:00.000Z', '１３日', '夕方'], // JST 15:00
    ['2026-10-12T09:00:00.000Z', '１３日', '夜のはじめ頃'], // JST 18:00
    ['2026-10-12T12:00:00.000Z', '１３日', '夜遅く'], // JST 21:00
  ];
  for (const [now, date, term] of terms) {
    const root = parseXml(single('warning-24', now).xml);
    const peak = path(
      path(root, 'Body', 'Warning')[3]!,
      'Item',
      'Kind',
      'Property',
      'SignificancyPart',
      'Base',
      'PeakTime',
    )[0]!;
    assert.equal(textAt(peak, 'Date'), date, now);
    assert.equal(textAt(peak, 'Term'), term, now);
  }
  for (const itemId of ['warning-14', 'warning-19']) {
    assert.equal(parseXml(single(itemId).xml).getElementsByTagName('PeakTime').length, 0);
  }
});

function criteria(itemId: string, now: string) {
  const root = parseXml(single(itemId, now).xml);
  const kind = path(path(root, 'Body', 'Warning')[3]!, 'Item', 'Kind')[0]!;
  const properties = path(kind, 'Property');
  return {
    kind,
    risk: properties[0]!,
    exceed: properties[1]!,
    peak: properties[2]!,
    base: path(properties[0]!, 'CriteriaPeriod', 'Base')[0]!,
  };
}

test('高潮L2/L3/L4: 基準到達の18/12/6時間前発表、Duration PT4H、Sentenceは到達から4時間', () => {
  // T = JST 2026-10-11 23:59
  const rows: [string, string, string, string][] = [
    [
      'warning-19',
      '2026-10-12T17:59:00+09:00',
      '１２日１７時５９分から２１時５９分まで、警戒レベル４相当',
      '2026-10-12T18:59:00+09:00',
    ],
    [
      'warning-08',
      '2026-10-12T11:59:00+09:00',
      '１２日１１時５９分から１５時５９分まで、警戒レベル４相当',
      '2026-10-12T12:59:00+09:00',
    ],
    [
      'warning-48',
      '2026-10-12T05:59:00+09:00',
      '１２日５時５９分から９時５９分まで、警戒レベル４相当',
      '2026-10-12T06:59:00+09:00',
    ],
  ];
  for (const [itemId, reach, sentence, peak] of rows) {
    const c = criteria(itemId, NOW);
    assert.equal(textAt(c.base, 'Time'), reach, itemId);
    assert.equal(textAt(c.base, 'Duration'), 'PT4H');
    assert.equal(textAt(c.base, 'Sentence'), sentence);
    assert.equal(textAt(c.base, 'CriteriaClass', 'Name'), '警戒レベル４相当');
    assert.equal(textAt(c.base, 'CriteriaClass', 'Code'), '41');
    assert.deepEqual(
      kids(c.base).map((n) => n.localName),
      ['Sentence', 'CriteriaClass', 'Time', 'Duration'],
    );
    assert.equal(path(c.base, 'Local').length, 0);
    const exceed = path(c.exceed, 'TidalLevelPart', 'Base')[0]!;
    assert.equal(text(exceed.getElementsByTagNameNS(NS_EB, 'TidalLevel').item(0)!), '3.4');
    assert.equal(
      exceed.getElementsByTagNameNS(NS_EB, 'TidalLevel').item(0)!.getAttribute('type'),
      '潮位',
    );
    assert.equal(
      exceed.getElementsByTagNameNS(NS_EB, 'TidalLevel').item(0)!.getAttribute('unit'),
      'm',
    );
    assert.equal(textAt(exceed, 'Time'), reach);
    const peakBase = path(c.peak, 'TidalLevelPart', 'Base')[0]!;
    assert.equal(text(peakBase.getElementsByTagNameNS(NS_EB, 'TidalLevel').item(0)!), '3.8');
    assert.equal(
      peakBase.getElementsByTagNameNS(NS_EB, 'TidalLevel').item(0)!.getAttribute('type'),
      '最高潮位',
    );
    assert.equal(textAt(peakBase, 'Time'), peak);
    assert.equal(path(c.exceed, 'WaveHeightPart').length, 0);
  }
  // 日付またぎ: T=JST 14:00 の L4 は 20:00 到達、24:00（翌0時）まで
  const crossing = criteria('warning-48', '2026-10-11T05:00:30.000Z');
  assert.equal(
    textAt(crossing.base, 'Sentence'),
    '１１日２０時から１２日０時まで、警戒レベル４相当',
  );
  assert.equal(textAt(crossing.base, 'Time'), '2026-10-11T20:00:00+09:00');
});

test('高潮L5: CriteriaPeriodを省略せず直前正時、Duration省略、Condition=氾濫発生', () => {
  const c = criteria('warning-38', NOW); // T=JST 23:59 → 直前正時 23:00
  assert.equal(textAt(c.kind, 'Condition'), '氾濫発生');
  assert.deepEqual(
    kids(c.kind).map((n) => n.localName),
    ['Name', 'Code', 'Status', 'Condition', 'Property', 'Property', 'Property'],
  );
  assert.equal(textAt(c.risk, 'SignificancyPart', 'Base', 'Significancy', 'Code'), '51');
  assert.equal(textAt(c.base, 'Time'), '2026-10-11T23:00:00+09:00');
  assert.equal(textAt(c.base, 'Sentence'), '１１日２３時に警戒レベル５相当に到達した想定');
  assert.equal(textAt(c.base, 'CriteriaClass', 'Name'), '警戒レベル５相当');
  assert.equal(textAt(c.base, 'CriteriaClass', 'Code'), '51');
  assert.equal(path(c.base, 'Duration').length, 0);
  const exceed = path(c.exceed, 'TidalLevelPart', 'Base')[0]!;
  assert.equal(text(exceed.getElementsByTagNameNS(NS_EB, 'TidalLevel').item(0)!), '4.0');
  assert.equal(textAt(exceed, 'Time'), REPORT_JST);
  const peak = path(c.peak, 'TidalLevelPart', 'Base')[0]!;
  assert.equal(text(peak.getElementsByTagNameNS(NS_EB, 'TidalLevel').item(0)!), '4.2');
  assert.equal(textAt(peak, 'Time'), '2026-10-12T00:59:00+09:00');
  // Tが正時ならT自身
  const onHour = criteria('warning-38', '2026-10-11T05:00:30.000Z');
  assert.equal(textAt(onHour.base, 'Time'), '2026-10-11T14:00:00+09:00');
  // 高潮以外の特別警報にはCondition 氾濫発生を付けない
  assert.equal(parseXml(single('warning-33').xml).getElementsByTagName('Condition').length, 0);
});

// 気象防災速報 --------------------------------------------------------------

test('VPBS50: 線状降水帯発生/直前予測/記録的短時間大雨の構造', () => {
  const rows: [string, string, string, string, string][] = [
    [
      'bulletin-linear-occurrence',
      '線状降水帯発生',
      '東京都気象防災速報（線状降水帯発生）',
      'A',
      '線状降水帯発生',
    ],
    [
      'bulletin-linear-imminent',
      '線状降水帯直前',
      '東京都気象防災速報（線状降水帯直前予測）',
      'B',
      '線状降水帯予想',
    ],
  ];
  // 公式サンプル 82_01_01（発生）・82_03_01（直前）の文型
  const LINEAR_TEXT: Record<string, string> = {
    'bulletin-linear-occurrence':
      '東京都東京地方では、線状降水帯による非常に激しい雨が同じ場所で降り続いています。命に危険が及ぶ災害発生の危険度が急激に高まっています。',
    'bulletin-linear-imminent':
      '東京都東京地方では、今後３時間以内に線状降水帯が発生し、非常に激しい雨が同じ場所で降り続く可能性が高まっています。命に危険が及ぶ災害発生の危険度が急激に高まるおそれがあります。',
  };
  for (const [itemId, condition, title, suffix, eventName] of rows) {
    const telegram = single(itemId);
    assert.equal(telegram.telegramType, 'VPBS50');
    assert.equal(telegram.title, title);
    assert.deepEqual([...telegram.areaNames], ['東京地方']);
    const root = parseXml(telegram.xml);
    assert.equal(textAt(root, 'Control', 'Title'), '府県気象防災速報');
    assert.equal(textAt(root, 'Control', 'Status'), '訓練');
    assert.equal(textAt(root, 'Head', 'InfoKind'), '気象解説情報');
    assert.equal(textAt(root, 'Head', 'InfoKindVersion'), '1.5_0');
    assert.equal(textAt(root, 'Head', 'Serial'), '1');
    assert.equal(textAt(root, 'Head', 'EventID'), `TRAIN123e4567e89b42d3a456426614174000${suffix}`);
    const information = path(root, 'Head', 'Headline', 'Information')[0]!;
    assert.equal(information.getAttribute('type'), '情報タグ');
    assert.equal(textAt(information, 'Item', 'Kind', 'Name'), '情報タグ');
    assert.equal(textAt(information, 'Item', 'Kind', 'Condition'), condition);
    assert.equal(textAt(information, 'Item', 'Areas', 'Area', 'Code'), '130010');
    assert.equal(
      path(information, 'Item', 'Areas')[0]!.getAttribute('codeType'),
      '気象情報／府県予報区・細分区域等',
    );
    const info = path(root, 'Body', 'MeteorologicalInfos')[0]!;
    assert.equal(info.getAttribute('type'), '観測実況');
    const mInfo = path(info, 'MeteorologicalInfo')[0]!;
    assert.equal(textAt(mInfo, 'DateTime'), REPORT_JST);
    const event = path(mInfo, 'Item', 'Kind', 'Property', 'EventPart', 'Event')[0]!;
    assert.equal(textAt(mInfo, 'Item', 'Kind', 'Property', 'Type'), '気象現象の実況');
    assert.equal(event.getAttribute('type'), '線状降水帯');
    assert.equal(textAt(event, 'EventName'), eventName);
    // T=JST 23:59 → floor((T-10分)/10分)*10分 = 23:40
    assert.equal(textAt(event, 'Time'), '2026-10-11T23:40:00+09:00');
    assert.equal(textAt(mInfo, 'Item', 'Area', 'Code'), '130010');
    assert.equal(path(mInfo, 'Item', 'Station').length, 0);
    assert.equal(textAt(root, 'Head', 'Headline', 'Text'), BANNER + LINEAR_TEXT[itemId]);
  }

  const rain = single('bulletin-record-rain');
  assert.equal(rain.title, '東京都気象防災速報（記録的短時間大雨）');
  assert.deepEqual([...rain.areaNames], ['東京地方', '江東区']);
  const root = parseXml(rain.xml);
  assert.equal(textAt(root, 'Head', 'EventID'), 'TRAIN123e4567e89b42d3a456426614174000C');
  assert.equal(
    textAt(root, 'Head', 'Headline', 'Information', 'Item', 'Kind', 'Condition'),
    '記録雨',
  );
  assert.equal(
    textAt(root, 'Head', 'Headline', 'Information', 'Item', 'Areas', 'Area', 'Code'),
    '130010',
  );
  const item = path(root, 'Body', 'MeteorologicalInfos', 'MeteorologicalInfo', 'Item')[0]!;
  assert.equal(textAt(item, 'Kind', 'Property', 'Type'), '雨の実況');
  const precipitation = item.getElementsByTagNameNS(NS_EB, 'Precipitation').item(0)!;
  assert.equal(text(precipitation), '120');
  assert.equal(precipitation.getAttribute('type'), '前１時間解析雨量');
  assert.equal(precipitation.getAttribute('unit'), 'mm');
  assert.equal(precipitation.getAttribute('condition'), '約');
  assert.equal(precipitation.getAttribute('description'), '約１２０ミリ');
  assert.equal(
    textAt(item, 'Kind', 'Property', 'PrecipitationPart', 'Time'),
    '2026-10-11T23:40:00+09:00',
  );
  assert.equal(textAt(item, 'Area', 'Code'), '1310800');
  assert.equal(textAt(item, 'Area', 'Name'), '江東区');
  assert.equal(textAt(item, 'Area', 'Status'), '付近');
  assert.equal(path(item, 'Station').length, 0);
  assert.equal(
    textAt(root, 'Head', 'Headline', 'Text'),
    BANNER +
      '２３時４０分、東京都江東区で記録的短時間大雨。\n江東区付近で１時間に約１２０ミリ。\n猛烈な雨が降っており、災害発生の危険度が急激に高まっています。',
  );
});

test('VPBS50: 設計書例の発表14:10 JSTで解析時刻は14:00', () => {
  const rain = single('bulletin-record-rain', '2026-10-11T05:10:30.000Z');
  const root = parseXml(rain.xml);
  assert.equal(textAt(root, 'Head', 'ReportDateTime'), '2026-10-11T14:10:00+09:00');
  assert.equal(
    textAt(
      root,
      'Body',
      'MeteorologicalInfos',
      'MeteorologicalInfo',
      'Item',
      'Kind',
      'Property',
      'PrecipitationPart',
      'Time',
    ),
    '2026-10-11T14:00:00+09:00',
  );
  assert.match(
    textAt(root, 'Head', 'Headline', 'Text'),
    /^＊＊＊これは訓練です＊＊＊\n１４時００分、東京都江東区で記録的短時間大雨。\n/,
  );
});

// 竜巻 ----------------------------------------------------------------------

test('VPHW50/51: 4階層Information・Body Warning・ValidDateTime・EventID空', () => {
  const rows: [string, TrainingTelegramType, string, string, string, string][] = [
    ['bulletin-tornado', 'VPHW50', '竜巻注意情報', '1.0_0', '東京都気象防災速報（竜巻注意）', ''],
    [
      'bulletin-tornado-observed',
      'VPHW51',
      '竜巻注意情報（目撃情報付き）',
      '1.1_0',
      '東京都気象防災速報（竜巻目撃）',
      '竜巻注意情報（目撃情報あり）',
    ],
  ];
  for (const [itemId, type, controlTitle, version, title, sighting] of rows) {
    const telegram = single(itemId);
    assert.equal(telegram.telegramType, type);
    assert.equal(telegram.title, title);
    assert.deepEqual([...telegram.areaNames], ['東京都', '東京地方', '２３区東部', '江東区']);
    const root = parseXml(telegram.xml);
    assert.equal(textAt(root, 'Control', 'Title'), controlTitle);
    assert.equal(textAt(root, 'Head', 'InfoKind'), '竜巻注意情報');
    assert.equal(textAt(root, 'Head', 'InfoKindVersion'), version);
    assert.equal(textAt(root, 'Head', 'EventID'), '');
    assert.equal(textAt(root, 'Head', 'Serial'), '1');
    assert.equal(textAt(root, 'Head', 'InfoType'), '発表');
    // T=JST 23:59 → +60分=翌0:59 → 10分境界へ切上げ=翌1:00
    assert.equal(textAt(root, 'Head', 'ValidDateTime'), '2026-10-12T01:00:00+09:00');
    assert.equal(telegram.validDateTime, '2026-10-11T16:00:00.000Z');
    const types = path(root, 'Head', 'Headline', 'Information').map((n) => n.getAttribute('type'));
    assert.deepEqual(types, [
      '竜巻注意情報（発表細分）',
      '竜巻注意情報（一次細分区域等）',
      '竜巻注意情報（市町村等をまとめた地域等）',
      '竜巻注意情報（市町村等）',
      ...(sighting ? [sighting] : []),
    ]);
    const codes = path(root, 'Head', 'Headline', 'Information').map((information) =>
      textAt(information, 'Item', 'Areas', 'Area', 'Code'),
    );
    assert.deepEqual(codes, [
      '130000',
      '130010',
      '130012',
      '1310800',
      ...(sighting ? ['1310800'] : []),
    ]);
    for (const information of path(root, 'Head', 'Headline', 'Information')) {
      assert.equal(textAt(information, 'Item', 'Kind', 'Name'), '竜巻注意情報');
      assert.equal(textAt(information, 'Item', 'Kind', 'Code'), '1');
      assert.equal(textAt(information, 'Item', 'Kind', 'Condition'), '発表');
    }
    const municipalAreas = path(root, 'Head', 'Headline', 'Information').map((information) =>
      path(information, 'Item', 'Areas')[0]!.getAttribute('codeType'),
    );
    assert.equal(municipalAreas[3], '気象・地震・火山情報／市町村等');
    assert.equal(municipalAreas[0], '気象情報／府県予報区・細分区域等');
    const warnings = path(root, 'Body', 'Warning');
    assert.deepEqual(
      warnings.map((n) => n.getAttribute('type')),
      types.slice(0, 4),
    );
    warnings.forEach((warning, index) => {
      assert.equal(path(warning, 'Item').length, 1);
      assert.equal(textAt(warning, 'Item', 'Kind', 'Name'), '竜巻注意情報');
      assert.equal(textAt(warning, 'Item', 'Kind', 'Code'), '1');
      assert.equal(textAt(warning, 'Item', 'Kind', 'Status'), '発表');
      assert.equal(textAt(warning, 'Item', 'Area', 'Code'), codes[index]);
    });
    // 公式サンプル 19_04_01（VPHW51）・19_08_03（VPHW50）の文型
    const caution =
      '空の様子に注意してください。雷や急な風の変化など積乱雲が近づく兆しがある場合には、頑丈な建物内に移動するなど、安全確保に努めてください。落雷、ひょう、急な強い雨にも注意してください。';
    assert.equal(
      textAt(root, 'Head', 'Headline', 'Text'),
      BANNER +
        (sighting
          ? '【目撃情報あり】東京都東京地方で竜巻などの激しい突風が発生したとみられます。東京地方は、竜巻などの激しい突風が発生するおそれが非常に高まっています。'
          : '東京都東京地方は、竜巻などの激しい突風が発生しやすい気象状況になっています。') +
        caution,
    );
  }
});

test('竜巻ValidDateTime: 発表時刻の60〜69分後の10分境界', () => {
  const rows: [string, string][] = [
    // now(UTC) → 期待ValidDateTime(JST)
    ['2026-10-11T05:10:00.000Z', '2026-10-11T15:10:00+09:00'], // 14:10 → 15:10（ちょうど60分後）
    ['2026-10-11T05:11:59.000Z', '2026-10-11T15:20:00+09:00'], // 14:11 → 15:20（69分後）
    ['2026-10-11T05:19:00.000Z', '2026-10-11T15:20:00+09:00'],
    ['2026-10-11T05:20:00.000Z', '2026-10-11T15:20:00+09:00'],
    ['2026-12-31T14:55:00.000Z', '2027-01-01T01:00:00+09:00'], // 年またぎ
    ['2026-10-31T14:51:00.000Z', '2026-11-01T01:00:00+09:00'], // 月またぎ（23:51 → 翌00:51 → 01:00）
  ];
  for (const [now, expected] of rows) {
    const root = parseXml(single('bulletin-tornado', now).xml);
    const valid = textAt(root, 'Head', 'ValidDateTime');
    const report = textAt(root, 'Head', 'ReportDateTime');
    assert.equal(valid, expected, now);
    const minutes = (Date.parse(valid) - Date.parse(report)) / 60000;
    assert.ok(minutes >= 60 && minutes <= 69, `${now}: ${minutes}`);
  }
});

// 時刻 ----------------------------------------------------------------------

test('時刻: 秒00の発表時刻・Controlの実時刻（月末・年末・JST日付跨ぎ）', () => {
  const rows: [string, string, string][] = [
    // now, 期待ReportDateTime(JST), 期待Control/DateTime(UTC Z)
    ['2026-12-31T14:59:45.000Z', '2026-12-31T23:59:00+09:00', '2026-12-31T14:59:45Z'],
    ['2026-12-31T15:00:00.000Z', '2027-01-01T00:00:00+09:00', '2026-12-31T15:00:00Z'],
    ['2026-10-31T15:30:59.999Z', '2026-11-01T00:30:00+09:00', '2026-10-31T15:30:59Z'],
    ['2028-02-28T15:00:01.000Z', '2028-02-29T00:00:00+09:00', '2028-02-28T15:00:01Z'],
    ['2026-10-11T14:59:59.999Z', '2026-10-11T23:59:00+09:00', '2026-10-11T14:59:59Z'],
  ];
  for (const [now, report, control] of rows) {
    const nowMs = Date.parse(now);
    // 独立実装の期待値と、表に書いた期待値が一致していることも確認する
    assert.equal(jstString(Math.floor(nowMs / 60000) * 60000), report);
    for (const itemId of ['warning-10', 'bulletin-linear-occurrence', 'bulletin-tornado']) {
      const telegram = single(itemId, now);
      const root = parseXml(telegram.xml);
      assert.equal(textAt(root, 'Head', 'ReportDateTime'), report, `${itemId} ${now}`);
      assert.equal(textAt(root, 'Head', 'TargetDateTime'), report);
      assert.equal(textAt(root, 'Control', 'DateTime'), control);
      assert.equal(
        telegram.reportDateTime,
        new Date(Math.floor(nowMs / 60000) * 60000).toISOString(),
      );
    }
  }
});

test('時刻: 記録雨・線状降水帯の実況は過去側、日付を跨ぐ', () => {
  // now = JST 2027-01-01 00:05 → T-10分=前日23:55 → 10分切捨て=23:50(前日)
  const root = parseXml(single('bulletin-record-rain', '2026-12-31T15:05:20.000Z').xml);
  const time = textAt(
    root,
    'Body',
    'MeteorologicalInfos',
    'MeteorologicalInfo',
    'Item',
    'Kind',
    'Property',
    'PrecipitationPart',
    'Time',
  );
  assert.equal(time, '2026-12-31T23:50:00+09:00');
  assert.ok(Date.parse(time) < Date.parse(textAt(root, 'Head', 'ReportDateTime')));
  assert.match(textAt(root, 'Head', 'Headline', 'Text'), /２３時５０分/);
  const linear = parseXml(single('bulletin-linear-occurrence', '2026-12-31T15:00:30.000Z').xml);
  // T=JST 00:00 → T-10=23:50 → 23:50
  assert.equal(
    textAt(
      linear,
      'Body',
      'MeteorologicalInfos',
      'MeteorologicalInfo',
      'Item',
      'Kind',
      'Property',
      'EventPart',
      'Event',
      'Time',
    ),
    '2026-12-31T23:50:00+09:00',
  );
});

// 複数選択 ------------------------------------------------------------------

const MAX_SELECTION = [
  'warning-10',
  'warning-29',
  'warning-19',
  'warning-15',
  'warning-16',
  'warning-12',
  'warning-14',
  'warning-20',
  'warning-21',
  'warning-23',
  'warning-24',
  'warning-25',
  'warning-26',
  'bulletin-linear-occurrence',
  'bulletin-record-rain',
  'bulletin-tornado',
];

test('最大セット（16 group）: 異系列は別XML、VPWW61は1XMLにコード昇順で全件、順序は規定どおり', () => {
  assert.ok(parseTrainingItemIds(MAX_SELECTION) !== null);
  const result = generate(MAX_SELECTION);
  assert.deepEqual(
    result.map((telegram) => telegram.telegramType),
    [
      'VPWW55',
      'VPWW56',
      'VPWW57',
      'VPWW58',
      'VPWW59',
      'VPWW60',
      'VPWW61',
      'VPBS50',
      'VPBS50',
      'VPHW50',
    ],
  );
  const other = result[6]!;
  assert.deepEqual(
    [...other.itemIds],
    [
      'warning-14',
      'warning-20',
      'warning-21',
      'warning-23',
      'warning-24',
      'warning-25',
      'warning-26',
    ],
  );
  assert.equal(other.title, '東京都雷・濃霧・乾燥・低温・霜・着氷・着雪注意報');
  const root = parseXml(other.xml);
  assert.equal(textAt(root, 'Control', 'Title'), '気象警報・注意報（Ｒ０６）（その他注意報）');
  const expectedCodes = ['14', '20', '21', '23', '24', '25', '26'];
  const expectedNames = [
    '雷注意報',
    '濃霧注意報',
    '乾燥注意報',
    '低温注意報',
    '霜注意報',
    '着氷注意報',
    '着雪注意報',
  ];
  for (const information of path(root, 'Head', 'Headline', 'Information')) {
    const kindList = path(information, 'Item', 'Kind');
    assert.deepEqual(
      kindList.map((kind) => textAt(kind, 'Name')),
      expectedNames,
    );
    assert.deepEqual(
      kindList.map((kind) => textAt(kind, 'Code')),
      expectedCodes,
    );
  }
  for (const warning of path(root, 'Body', 'Warning')) {
    const items = path(warning, 'Item');
    assert.equal(items.length, 1);
    assert.deepEqual(
      path(items[0]!, 'Kind').map((kind) => textAt(kind, 'Code')),
      expectedCodes,
    );
  }
  assert.equal(
    textAt(root, 'Head', 'Headline', 'Text'),
    BANNER +
      '東京都では、急な強い雨や落雷、濃い霧、空気の乾燥、低温、霜、着氷、着雪に注意してください。',
  );
  // 各電文は自分の選択項目だけを含む
  assert.deepEqual(
    result.map((telegram) => telegram.itemIds.length),
    [1, 1, 1, 1, 1, 1, 7, 1, 1, 1],
  );
});

test('生成は決定的で、同じ分の再生成ではEventID（VPBS50）だけが生成セットごとに変わる', () => {
  const first = generate(MAX_SELECTION);
  const again = generate(MAX_SELECTION);
  assert.deepEqual(first, again);
  const otherId = '223e4567-e89b-42d3-a456-426614174999';
  const second = generate(MAX_SELECTION, NOW, otherId);
  const eventIds = (telegrams: ReturnType<typeof generate>) =>
    telegrams
      .filter((telegram) => telegram.telegramType === 'VPBS50')
      .map((telegram) => textAt(parseXml(telegram.xml), 'Head', 'EventID'));
  assert.notDeepEqual(eventIds(first), eventIds(second));
  assert.equal(new Set([...eventIds(first), ...eventIds(second)]).size, 4);
  for (const telegram of second.filter(
    (entry) => entry.telegramType.startsWith('VPWW') || entry.telegramType.startsWith('VPHW'),
  )) {
    assert.equal(textAt(parseXml(telegram.xml), 'Head', 'EventID'), '');
  }
  // 発表時刻は同じ
  assert.equal(first[0]!.reportDateTime, second[0]!.reportDateTime);
});

test('公式サンプル由来の地名・時刻・前報を出力しない', () => {
  const xml = generate(MAX_SELECTION)
    .map((telegram) => telegram.xml)
    .join('\n');
  for (const forbidden of [
    '稚内',
    '宗谷',
    '千葉',
    '網走',
    '美幌',
    '埼玉',
    '京都府',
    '京都市',
    '舞鶴',
    '2023-',
    '2020-',
    '2015-',
    '2014-',
    '<LastKind',
    '<NextKinds',
  ]) {
    assert.ok(!xml.includes(forbidden), forbidden);
  }
  assert.ok(!xml.includes('<!DOCTYPE'));
  assert.ok(!xml.includes('<Station'));
});

// parser往復 ------------------------------------------------------------------

test('全選択可能項目のparser往復（独立した期待表）', () => {
  const nowMs = Date.parse(NOW);
  const controlDateTime = new Date(Math.floor(nowMs / 1000) * 1000).toISOString();
  const reportDateTime = '2026-10-11T14:59:00.000Z';
  for (const expected of WARNING_EXPECTATIONS) {
    const telegram = single(expected.itemId);
    const result = parseWarningTelegram(
      telegram.xml,
      {
        telegramType: expected.telegram,
        controlStatus: 'training',
        reportDateTime,
        controlDateTime,
      },
      { municipalCode: '1310800', displayName: '江東区' },
    );
    assert.ok(result.ok, `${expected.itemId}: ${result.ok ? '' : result.reason}`);
    if (!result.ok) continue;
    assert.equal(result.value.controlStatus, 'training');
    assert.equal(result.value.telegramType, expected.telegram);
    assert.equal(result.value.reportDateTime, reportDateTime);
    assert.equal(result.value.targetDateTime, reportDateTime);
    assert.equal(result.value.controlDateTime, controlDateTime);
    assert.equal(result.value.infoType, '発表');
    assert.equal(result.value.eventId, null);
    assert.equal(result.value.area.code, '1310800');
    assert.equal(result.value.area.name, '江東区');
    assert.equal(result.value.kinds.length, 1);
    const kind = result.value.kinds[0]!;
    assert.equal(kind.kindType, 'warning');
    if (kind.kindType === 'warning') {
      assert.equal(kind.code, expected.itemId.replace('warning-', ''));
      assert.equal(kind.name, expected.name);
      assert.equal(kind.status, '発表');
      assert.equal(kind.properties.length, expected.properties.length);
    }
  }
  const bulletinRows: [string, string, string][] = [
    ['bulletin-linear-occurrence', '線状降水帯発生', 'TRAIN123e4567e89b42d3a456426614174000A'],
    ['bulletin-linear-imminent', '線状降水帯直前', 'TRAIN123e4567e89b42d3a456426614174000B'],
    ['bulletin-record-rain', '記録雨', 'TRAIN123e4567e89b42d3a456426614174000C'],
  ];
  for (const [itemId, tag, eventId] of bulletinRows) {
    const result = parseVpbs50(
      single(itemId).xml,
      { telegramType: 'VPBS50', controlStatus: 'training', reportDateTime, controlDateTime },
      { includedAreaCodes: ['1310800', '130012', '130010'] },
    );
    assert.ok(result.ok, `${itemId}: ${result.ok ? '' : result.reason}`);
    if (!result.ok) continue;
    assert.equal(result.value.controlStatus, 'training');
    assert.equal(result.value.informationTag, tag);
    assert.equal(result.value.eventId, eventId);
    assert.equal(result.value.infoType, '発表');
    assert.equal(result.value.isCancelled, false);
    assert.ok(result.value.areas.some((area) => area.areaCode === '130010'));
    assert.equal(
      result.value.areas.some((area) => area.areaCode === '1310800'),
      itemId === 'bulletin-record-rain',
    );
  }
  for (const [itemId, type, sighting] of [
    ['bulletin-tornado', 'VPHW50', null],
    ['bulletin-tornado-observed', 'VPHW51', true],
  ] as const) {
    const result = parseVphw(
      single(itemId).xml,
      { telegramType: type, controlStatus: 'training', reportDateTime, controlDateTime },
      { includedAreaCodes: ['1310800', '130012', '130010'] },
    );
    assert.ok(result.ok, `${itemId}: ${result.ok ? '' : result.reason}`);
    if (!result.ok) continue;
    assert.equal(result.value.controlStatus, 'training');
    assert.equal(result.value.telegramType, type);
    assert.equal(result.value.validDateTime, '2026-10-11T16:00:00.000Z');
    assert.equal(result.value.hasSighting, sighting);
    assert.equal(result.value.eventId, `${type}:130000`);
    assert.deepEqual(
      [...new Set(result.value.areas.map((area) => area.areaCode))].sort(),
      ['130000', '130010', '130012', '1310800'].sort(),
    );
  }
});

test('VPWW61の複数注意報もparserが全Kindをコード昇順で抽出する', () => {
  const telegram = generate(['warning-26', 'warning-14', 'warning-21'])[0]!;
  const result = parseWarningTelegram(
    telegram.xml,
    {
      telegramType: 'VPWW61',
      controlStatus: 'training',
      reportDateTime: '2026-10-11T14:59:00.000Z',
      controlDateTime: '2026-10-11T14:59:45.000Z',
    },
    { municipalCode: '1310800', displayName: '江東区' },
  );
  assert.ok(result.ok);
  if (result.ok) {
    assert.deepEqual(
      result.value.kinds.map((kind) => (kind.kindType === 'warning' ? kind.code : '')),
      ['14', '21', '26'],
    );
  }
});

// 入力・エスケープ ----------------------------------------------------------------

test('未知IDと不正な時刻は例外', () => {
  assert.throws(() => generate(['warning-99']));
  assert.throws(() => generate(['warning-09']));
  assert.throws(() => generate(['warning-10'], 'not-a-date'));
});

test('XML構築器は属性・本文をエスケープし、本文と子要素の混在を拒否する', () => {
  assert.equal(xmlEscape(`<&>"'`), '&lt;&amp;&gt;&quot;&apos;');
  const xml = serializeXml(el('A', { b: `"<&'` }, el('C', null, '<![CDATA[x]]>&'), el('D', null)));
  assert.match(xml, /<A b="&quot;&lt;&amp;&apos;">/);
  assert.match(xml, /<C>&lt;!\[CDATA\[x\]\]&gt;&amp;<\/C>/);
  assert.match(xml, /<D\/>/);
  assert.throws(() => el('A', null, 'text', el('B', null)));
  assert.doesNotThrow(() => parseXml(xml));
});
