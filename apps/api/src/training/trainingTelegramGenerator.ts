import type { TrainingItemId, TrainingTelegramType } from '@wx-viewer-poc/shared';
import {
  BULLETIN_DEFINITIONS,
  BULLETIN_INFO_KIND_VERSION,
  PHENOMENA,
  TORNADO_DEFINITIONS,
  TORNADO_INFORMATION_TIERS,
  TORNADO_SIGHTING_INFORMATION_TYPE,
  TRAINING_AREA_GROUP,
  TRAINING_AREA_MUNICIPAL,
  TRAINING_AREA_PREFECTURE,
  TRAINING_AREA_PRIMARY,
  WARNING_CONTROL_TITLE_SUFFIX,
  WARNING_DEFINITIONS,
  WARNING_HEAD_TITLE,
  WARNING_INFORMATION_TIERS,
  WARNING_INFO_KIND_VERSION,
  bulletinEventId,
  findWarningDefinition,
  quantityPropertyType,
  significancyOf,
  type BulletinDefinition,
  type TornadoDefinition,
  type TrainingArea,
  type WarningDefinition,
  type WarningTelegramType,
} from './trainingItemDefinitions.js';
import { el, serializeXml, toFullWidth, type XmlNode } from './trainingXmlBuilder.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const JST_OFFSET_MS = 9 * HOUR_MS;

const NS_REPORT = 'http://xml.kishou.go.jp/jmaxml1/';
const NS_HEAD = 'http://xml.kishou.go.jp/jmaxml1/informationBasis1/';
const NS_BODY = 'http://xml.kishou.go.jp/jmaxml1/body/meteorology1/';
const NS_EB = 'http://xml.kishou.go.jp/jmaxml1/elementBasis1/';

const WARNING_TELEGRAM_ORDER: readonly WarningTelegramType[] = [
  'VPWW55',
  'VPWW56',
  'VPWW57',
  'VPWW58',
  'VPWW59',
  'VPWW60',
  'VPWW61',
];

export interface GeneratedTrainingTelegram {
  readonly itemIds: readonly TrainingItemId[];
  readonly telegramType: TrainingTelegramType;
  /** Head/Title */
  readonly title: string;
  readonly xml: string;
  /** UTC ISO（発表時刻T）。 */
  readonly reportDateTime: string;
  readonly targetDateTime: string;
  readonly validDateTime: string | null;
  readonly areaNames: readonly string[];
}

export interface GenerateOptions {
  /** 生成時点（UTC ISO）。 */
  readonly now: string;
  /** アプリ内の生成セットID。BulletinのEventIDにのみ反映する。 */
  readonly generationId: string;
}

interface TimeContext {
  /** 発表時刻T（分切り捨て、epoch ms）。 */
  readonly t: number;
  /** Control/DateTime（秒切り捨てのUTC Z）。 */
  readonly controlDateTime: string;
  readonly generationId: string;
}

/** 「Z」形式（ミリ秒なし）の UTC 文字列。 */
export function formatUtcSeconds(epochMs: number): string {
  return new Date(Math.floor(epochMs / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** JST（+09:00）形式。秒まで出力する。 */
export function formatJst(epochMs: number): string {
  const d = new Date(epochMs + JST_OFFSET_MS);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+09:00`
  );
}

interface JstParts {
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

function jstParts(epochMs: number): JstParts {
  const d = new Date(epochMs + JST_OFFSET_MS);
  return { day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

/** 本文用の時刻。分が0なら「６時」、そうでなければ「６時１０分」。 */
function clockText(parts: JstParts): string {
  return parts.minute === 0
    ? `${toFullWidth(parts.hour)}時`
    : `${toFullWidth(parts.hour)}時${toFullWidth(parts.minute)}分`;
}

/** 別表6の3時間帯。 */
const TERMS = ['未明', '明け方', '朝', '昼前', '昼過ぎ', '夕方', '夜のはじめ頃', '夜遅く'] as const;

function termOf(hour: number): string {
  return TERMS[Math.floor(hour / 3)]!;
}

function selectedKinds(definitions: readonly WarningDefinition[]): WarningDefinition[] {
  return [...definitions].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

function simple(name: string, text: string): XmlNode {
  return el(name, null, text);
}

function areaNode(area: TrainingArea): XmlNode {
  return el('Area', null, simple('Name', area.name), simple('Code', area.code));
}

function quantity(
  name: string,
  attributes: Readonly<Record<string, string>>,
  value: string,
): XmlNode {
  return el(`jmx_eb:${name}`, attributes, value);
}

function report(control: XmlNode, head: XmlNode, body: XmlNode): XmlNode {
  return el('Report', { xmlns: NS_REPORT, 'xmlns:jmx': NS_REPORT }, control, head, body);
}

function controlNode(title: string, ctx: TimeContext): XmlNode {
  return el(
    'Control',
    null,
    simple('Title', title),
    simple('DateTime', ctx.controlDateTime),
    simple('Status', '訓練'),
    simple('EditorialOffice', '気象庁'),
    simple('PublishingOffice', '気象庁'),
  );
}

function headNode(input: {
  readonly title: string;
  readonly ctx: TimeContext;
  readonly validDateTimeMs?: number;
  readonly eventId: string;
  readonly serial: string | null;
  readonly infoKind: string;
  readonly version: string;
  readonly headline: XmlNode;
}): XmlNode {
  const reportDateTime = formatJst(input.ctx.t);
  return el(
    'Head',
    { xmlns: NS_HEAD },
    simple('Title', input.title),
    simple('ReportDateTime', reportDateTime),
    simple('TargetDateTime', reportDateTime),
    input.validDateTimeMs === undefined
      ? null
      : simple('ValidDateTime', formatJst(input.validDateTimeMs)),
    input.eventId === '' ? el('EventID', null) : simple('EventID', input.eventId),
    simple('InfoType', '発表'),
    input.serial === null ? el('Serial', null) : simple('Serial', input.serial),
    simple('InfoKind', input.infoKind),
    simple('InfoKindVersion', input.version),
    input.headline,
  );
}

function bodyNode(...children: readonly XmlNode[]): XmlNode {
  return el('Body', { xmlns: NS_BODY, 'xmlns:jmx_eb': NS_EB }, ...children);
}

// ---------------------------------------------------------------------------
// 警報・注意報（VPWW55–61）
// ---------------------------------------------------------------------------

function significancyNode(definition: WarningDefinition, extra?: XmlNode): XmlNode {
  const sig = significancyOf(definition);
  return el(
    'Property',
    null,
    simple('Type', PHENOMENA[definition.phenomenon].riskType),
    el(
      'SignificancyPart',
      null,
      el(
        'Base',
        null,
        el(
          'Significancy',
          { type: PHENOMENA[definition.phenomenon].riskType },
          simple('Name', sig.name),
          simple('Code', sig.code),
        ),
        extra,
      ),
    ),
  );
}

/** Kind/Code ごとの警戒レベル相当クラス（CriteriaClass）。 */
function criteriaClass(name: string, code: string): XmlNode {
  return el('CriteriaClass', null, simple('Name', name), simple('Code', code));
}

function dayClockRange(startMs: number, endMs: number): string {
  const start = jstParts(startMs);
  const end = jstParts(endMs);
  const startText = `${toFullWidth(start.day)}日${clockText(start)}`;
  const endText =
    start.day === end.day ? clockText(end) : `${toFullWidth(end.day)}日${clockText(end)}`;
  return `${startText}から${endText}まで`;
}

function tidalNode(
  type: string,
  elementType: '潮位' | '最高潮位',
  value: string,
  timeMs: number,
): XmlNode {
  return el(
    'Property',
    null,
    simple('Type', type),
    el(
      'TidalLevelPart',
      null,
      el(
        'Base',
        null,
        quantity(
          'TidalLevel',
          {
            type: elementType,
            unit: 'm',
            description: `${toFullWidth(value)}メートルの高さ`,
          },
          value,
        ),
        simple('Time', formatJst(timeMs)),
      ),
    ),
  );
}

/** 高潮は予報区間を作らず、地域全体のBaseで表現する。 */
function surgeProperties(definition: WarningDefinition, ctx: TimeContext): XmlNode[] {
  const level = definition.level;
  const sig = significancyOf(definition);
  if (level === 5) {
    const reachedMs = Math.floor(ctx.t / HOUR_MS) * HOUR_MS;
    const parts = jstParts(reachedMs);
    const sentence = `${toFullWidth(parts.day)}日${clockText(parts)}に警戒レベル５相当に到達した想定`;
    return [
      el(
        'Property',
        null,
        simple('Type', PHENOMENA.surge.riskType),
        el(
          'SignificancyPart',
          null,
          el(
            'Base',
            null,
            el(
              'Significancy',
              { type: PHENOMENA.surge.riskType },
              simple('Name', sig.name),
              simple('Code', sig.code),
            ),
          ),
        ),
        el(
          'CriteriaPeriod',
          null,
          el(
            'Base',
            null,
            simple('Sentence', sentence),
            criteriaClass('警戒レベル５相当', '51'),
            simple('Time', formatJst(reachedMs)),
          ),
        ),
      ),
      tidalNode('高潮基準超過', '潮位', '4.0', ctx.t),
      tidalNode('高潮ピーク', '最高潮位', '4.2', ctx.t + HOUR_MS),
    ];
  }
  // L2/L3/L4 は基準到達のおおむね18/12/6時間前の初回発表（訓練シナリオ）。
  const leadHours = level === 2 ? 18 : level === 3 ? 12 : 6;
  const reachedMs = ctx.t + leadHours * HOUR_MS;
  const durationMs = 4 * HOUR_MS;
  return [
    el(
      'Property',
      null,
      simple('Type', PHENOMENA.surge.riskType),
      el(
        'SignificancyPart',
        null,
        el(
          'Base',
          null,
          el(
            'Significancy',
            { type: PHENOMENA.surge.riskType },
            simple('Name', sig.name),
            simple('Code', sig.code),
          ),
        ),
      ),
      el(
        'CriteriaPeriod',
        null,
        el(
          'Base',
          null,
          simple(
            'Sentence',
            `${dayClockRange(reachedMs, reachedMs + durationMs)}、警戒レベル４相当`,
          ),
          criteriaClass('警戒レベル４相当', '41'),
          simple('Time', formatJst(reachedMs)),
          simple('Duration', 'PT4H'),
        ),
      ),
    ),
    tidalNode('高潮基準超過', '潮位', '3.4', reachedMs),
    tidalNode('高潮ピーク', '最高潮位', '3.8', reachedMs + HOUR_MS),
  ];
}

const SEVERITY_INDEX = { advisory: 0, warning: 1, special: 2 } as const;

function quantityProperty(definition: WarningDefinition): XmlNode | null {
  const type = quantityPropertyType(definition.phenomenon);
  if (type === null) return null;
  const severity = SEVERITY_INDEX[definition.severity];
  switch (definition.phenomenon) {
    case 'wind': {
      const speed = [15, 30, 50][severity]!;
      const direction = definition.snowWind ? '北' : '南';
      const condition: Record<string, string> = definition.snowWind ? { condition: '風雪' } : {};
      return el(
        'Property',
        null,
        simple('Type', type),
        el(
          'WindDirectionPart',
          null,
          el(
            'Base',
            null,
            quantity(
              'WindDirection',
              { ...condition, description: `${direction}の風`, type: '風向', unit: '８方位漢字' },
              direction,
            ),
          ),
        ),
        el(
          'WindSpeedPart',
          null,
          el(
            'Base',
            null,
            quantity(
              'WindSpeed',
              {
                ...condition,
                description: `${toFullWidth(speed)}メートル`,
                type: '最大風速',
                unit: 'm/s',
              },
              String(speed),
            ),
          ),
        ),
      );
    }
    case 'snow': {
      const depth = [5, 15, 50][severity]!;
      return el(
        'Property',
        null,
        simple('Type', type),
        el(
          'SnowfallDepthPart',
          null,
          el(
            'Base',
            null,
            quantity(
              'SnowfallDepth',
              {
                description: `${toFullWidth(depth)}センチ`,
                type: '１２時間最大降雪量',
                unit: 'cm',
              },
              String(depth),
            ),
          ),
        ),
      );
    }
    case 'wave': {
      const height = [2, 4, 8][severity]!;
      return el(
        'Property',
        null,
        simple('Type', type),
        el(
          'WaveHeightPart',
          null,
          el(
            'Base',
            null,
            quantity(
              'WaveHeight',
              { description: `${toFullWidth(height)}メートル`, type: '波高', unit: 'm' },
              String(height),
            ),
          ),
        ),
      );
    }
    case 'fog':
      return el(
        'Property',
        null,
        simple('Type', type),
        el(
          'VisibilityPart',
          null,
          el(
            'Base',
            null,
            quantity(
              'Visibility',
              { condition: '以下', description: '１００メートル以下', type: '視程', unit: 'm' },
              '100',
            ),
          ),
        ),
      );
    case 'dry':
      return el(
        'Property',
        null,
        simple('Type', type),
        el(
          'HumidityPart',
          null,
          el(
            'Base',
            null,
            quantity(
              'Humidity',
              { description: '４０パーセント', type: '実効湿度', unit: '%' },
              '40',
            ),
          ),
        ),
        el(
          'HumidityPart',
          null,
          el(
            'Base',
            null,
            quantity(
              'Humidity',
              { description: '２０パーセント', type: '最小湿度', unit: '%' },
              '20',
            ),
          ),
        ),
      );
    default:
      return null;
  }
}

function municipalProperties(definition: WarningDefinition, ctx: TimeContext): XmlNode[] {
  if (definition.phenomenon === 'surge') return surgeProperties(definition, ctx);
  let peak: XmlNode | undefined;
  if (definition.phenomenon === 'frost') {
    const peakMs = ctx.t + 24 * HOUR_MS;
    const parts = jstParts(peakMs);
    peak = el(
      'PeakTime',
      null,
      simple('Date', `${toFullWidth(parts.day)}日`),
      simple('Term', termOf(parts.hour)),
    );
  }
  const quantityNode = quantityProperty(definition);
  return [significancyNode(definition, peak), ...(quantityNode ? [quantityNode] : [])];
}

function warningKindNode(
  definition: WarningDefinition,
  tierUpper: boolean,
  ctx: TimeContext,
): XmlNode {
  const condition =
    definition.phenomenon === 'surge' && definition.level === 5
      ? simple('Condition', '氾濫発生')
      : null;
  return el(
    'Kind',
    null,
    simple('Name', definition.name),
    simple('Code', definition.code),
    simple('Status', '発表'),
    condition,
    ...(tierUpper ? [] : municipalProperties(definition, ctx)),
  );
}

function warningHeadTitle(
  telegramType: WarningTelegramType,
  kinds: readonly WarningDefinition[],
): string {
  if (telegramType !== 'VPWW61') return WARNING_HEAD_TITLE[telegramType];
  const names = kinds.map((kind) => PHENOMENA[kind.phenomenon].shortName);
  return `東京都${names.join('・')}注意報`;
}

function generateWarningTelegram(
  telegramType: WarningTelegramType,
  definitions: readonly WarningDefinition[],
  ctx: TimeContext,
): GeneratedTrainingTelegram {
  const kinds = selectedKinds(definitions);
  const title = warningHeadTitle(telegramType, kinds);
  const headlineInformation = WARNING_INFORMATION_TIERS.map((tier) =>
    el(
      'Information',
      { type: tier.type },
      el(
        'Item',
        null,
        ...kinds.map((kind) =>
          el('Kind', null, simple('Name', kind.name), simple('Code', kind.code)),
        ),
        el('Areas', { codeType: tier.area.codeType }, areaNode(tier.area)),
      ),
    ),
  );
  const headline = el(
    'Headline',
    null,
    simple(
      'Text',
      `【訓練】江東区に${kinds.map((kind) => kind.name).join('、')}を発表する想定です。`,
    ),
    ...headlineInformation,
  );
  const bodyWarnings = WARNING_INFORMATION_TIERS.map((tier) =>
    el(
      'Warning',
      { type: tier.type },
      el(
        'Item',
        null,
        ...kinds.map((kind) => warningKindNode(kind, tier.upper, ctx)),
        areaNode(tier.area),
        simple('ChangeStatus', '警報・注意報種別に変化有'),
        tier.upper ? simple('FullStatus', '一部') : null,
        tier.upper ? simple('EditingMark', '0') : null,
      ),
    ),
  );
  const xml = serializeXml(
    report(
      controlNode(
        `気象警報・注意報（Ｒ０６）（${WARNING_CONTROL_TITLE_SUFFIX[telegramType]}）`,
        ctx,
      ),
      headNode({
        title,
        ctx,
        eventId: '',
        serial: null,
        infoKind: '気象警報・注意報',
        version: WARNING_INFO_KIND_VERSION,
        headline,
      }),
      bodyNode(...bodyWarnings),
    ),
  );
  const reportDateTime = new Date(ctx.t).toISOString();
  return {
    itemIds: kinds.map((kind) => kind.itemId),
    telegramType,
    title,
    xml,
    reportDateTime,
    targetDateTime: reportDateTime,
    validDateTime: null,
    areaNames: WARNING_INFORMATION_TIERS.map((tier) => tier.area.name),
  };
}

// ---------------------------------------------------------------------------
// 気象防災速報（VPBS50）
// ---------------------------------------------------------------------------

function observationTimeMs(ctx: TimeContext): number {
  const tenMinutes = 10 * MINUTE_MS;
  return Math.floor((ctx.t - tenMinutes) / tenMinutes) * tenMinutes;
}

function bulletinHeadlineText(definition: BulletinDefinition, observedMs: number): string {
  const clock = clockText(jstParts(observedMs));
  switch (definition.kind) {
    case 'linear-occurrence':
      return (
        `【訓練】${clock}頃、東京地方で線状降水帯が発生した想定です。` +
        '線状降水帯による非常に激しい雨が同じ場所で降り続いている想定で、' +
        '命に危険が及ぶ災害発生の危険度が急激に高まっています。'
      );
    case 'linear-imminent':
      return (
        '【訓練】東京地方では、今後３時間以内に線状降水帯が発生する可能性がある想定です。' +
        '大雨による災害発生の危険度が急激に高まるおそれがあります。'
      );
    case 'record-rain':
      return (
        `【訓練】${clock}、東京都江東区で記録的短時間大雨の想定です。\n` +
        '江東区付近で１時間に約１２０ミリ。\n' +
        '猛烈な雨が降っている想定で、災害発生の危険度が急激に高まっています。'
      );
  }
}

function bulletinBodyItem(definition: BulletinDefinition, observedMs: number): XmlNode {
  const observed = formatJst(observedMs);
  if (definition.kind === 'record-rain') {
    return el(
      'Item',
      null,
      el(
        'Kind',
        null,
        el(
          'Property',
          null,
          simple('Type', '雨の実況'),
          el(
            'PrecipitationPart',
            null,
            quantity(
              'Precipitation',
              {
                description: '約１２０ミリ',
                type: '前１時間解析雨量',
                unit: 'mm',
                condition: '約',
              },
              '120',
            ),
            simple('Time', observed),
          ),
        ),
      ),
      el(
        'Area',
        { codeType: TRAINING_AREA_MUNICIPAL.codeType },
        simple('Name', TRAINING_AREA_MUNICIPAL.name),
        simple('Code', TRAINING_AREA_MUNICIPAL.code),
        simple('Status', '付近'),
      ),
    );
  }
  const eventName = definition.kind === 'linear-occurrence' ? '線状降水帯発生' : '線状降水帯予想';
  return el(
    'Item',
    null,
    el(
      'Kind',
      null,
      el(
        'Property',
        null,
        simple('Type', '気象現象の実況'),
        el(
          'EventPart',
          null,
          el(
            'Event',
            { type: '線状降水帯' },
            simple('EventName', eventName),
            simple('Time', observed),
          ),
        ),
      ),
    ),
    el(
      'Area',
      { codeType: TRAINING_AREA_PRIMARY.codeType },
      simple('Name', TRAINING_AREA_PRIMARY.name),
      simple('Code', TRAINING_AREA_PRIMARY.code),
    ),
  );
}

function generateBulletinTelegram(
  definition: BulletinDefinition,
  ctx: TimeContext,
): GeneratedTrainingTelegram {
  const observedMs = observationTimeMs(ctx);
  const title = `東京都気象防災速報（${definition.titleLabel}）`;
  const headline = el(
    'Headline',
    null,
    simple('Text', bulletinHeadlineText(definition, observedMs)),
    el(
      'Information',
      { type: '情報タグ' },
      el(
        'Item',
        null,
        el('Kind', null, simple('Name', '情報タグ'), simple('Condition', definition.condition)),
        el('Areas', { codeType: TRAINING_AREA_PRIMARY.codeType }, areaNode(TRAINING_AREA_PRIMARY)),
      ),
    ),
  );
  const xml = serializeXml(
    report(
      controlNode('府県気象防災速報', ctx),
      headNode({
        title,
        ctx,
        eventId: bulletinEventId(ctx.generationId, definition),
        serial: '1',
        infoKind: '気象解説情報',
        version: BULLETIN_INFO_KIND_VERSION,
        headline,
      }),
      bodyNode(
        el(
          'MeteorologicalInfos',
          { type: '観測実況' },
          el(
            'MeteorologicalInfo',
            null,
            simple('DateTime', formatJst(ctx.t)),
            bulletinBodyItem(definition, observedMs),
          ),
        ),
      ),
    ),
  );
  const reportDateTime = new Date(ctx.t).toISOString();
  return {
    itemIds: [definition.itemId],
    telegramType: 'VPBS50',
    title,
    xml,
    reportDateTime,
    targetDateTime: reportDateTime,
    validDateTime: null,
    areaNames:
      definition.kind === 'record-rain'
        ? [TRAINING_AREA_PRIMARY.name, TRAINING_AREA_MUNICIPAL.name]
        : [TRAINING_AREA_PRIMARY.name],
  };
}

// ---------------------------------------------------------------------------
// 竜巻注意情報（VPHW50/51）
// ---------------------------------------------------------------------------

/** T+60分を10分境界へ切り上げる（60〜69分後）。 */
export function tornadoValidTimeMs(t: number): number {
  const tenMinutes = 10 * MINUTE_MS;
  return Math.ceil((t + 60 * MINUTE_MS) / tenMinutes) * tenMinutes;
}

function tornadoKind(withStatus: 'Condition' | 'Status'): XmlNode {
  return el(
    'Kind',
    null,
    simple('Name', '竜巻注意情報'),
    simple('Code', '1'),
    simple(withStatus, '発表'),
  );
}

function tornadoText(definition: TornadoDefinition): string {
  const caution =
    '空の様子に注意してください。雷や急な風の変化など積乱雲が近づく兆しがある場合には、' +
    '頑丈な建物内に移動するなど、安全確保に努めてください。';
  if (definition.sighting) {
    return (
      '【訓練】江東区で竜巻などの激しい突風が発生したとみられる想定です。' +
      '東京地方は、竜巻などの激しい突風が発生するおそれが非常に高まっています。' +
      caution
    );
  }
  return (
    '【訓練】東京地方（江東区付近）は、竜巻などの激しい突風が発生しやすい気象状況になっている想定です。' +
    caution
  );
}

function generateTornadoTelegram(
  definition: TornadoDefinition,
  ctx: TimeContext,
): GeneratedTrainingTelegram {
  const validMs = tornadoValidTimeMs(ctx.t);
  const title = `東京都気象防災速報（${definition.titleLabel}）`;
  const informations = TORNADO_INFORMATION_TIERS.map((tier) =>
    el(
      'Information',
      { type: tier.type },
      el(
        'Item',
        null,
        tornadoKind('Condition'),
        el('Areas', { codeType: tier.area.codeType }, areaNode(tier.area)),
      ),
    ),
  );
  if (definition.sighting) {
    informations.push(
      el(
        'Information',
        { type: TORNADO_SIGHTING_INFORMATION_TYPE },
        el(
          'Item',
          null,
          tornadoKind('Condition'),
          el(
            'Areas',
            { codeType: TRAINING_AREA_MUNICIPAL.codeType },
            areaNode(TRAINING_AREA_MUNICIPAL),
          ),
        ),
      ),
    );
  }
  const headline = el('Headline', null, simple('Text', tornadoText(definition)), ...informations);
  const bodyWarnings = TORNADO_INFORMATION_TIERS.map((tier) =>
    el(
      'Warning',
      { type: tier.type },
      el('Item', null, tornadoKind('Status'), areaNode(tier.area)),
    ),
  );
  const xml = serializeXml(
    report(
      controlNode(definition.controlTitle, ctx),
      headNode({
        title,
        ctx,
        validDateTimeMs: validMs,
        eventId: '',
        serial: '1',
        infoKind: '竜巻注意情報',
        version: definition.version,
        headline,
      }),
      bodyNode(...bodyWarnings),
    ),
  );
  const reportDateTime = new Date(ctx.t).toISOString();
  return {
    itemIds: [definition.itemId],
    telegramType: definition.telegramType,
    title,
    xml,
    reportDateTime,
    targetDateTime: reportDateTime,
    validDateTime: new Date(validMs).toISOString(),
    areaNames: [
      TRAINING_AREA_PREFECTURE.name,
      TRAINING_AREA_PRIMARY.name,
      TRAINING_AREA_GROUP.name,
      TRAINING_AREA_MUNICIPAL.name,
    ],
  };
}

// ---------------------------------------------------------------------------
// 公開API
// ---------------------------------------------------------------------------

/**
 * 選択項目から合成電文を生成する純粋処理。ネットワーク・DB・環境時刻を参照せず、
 * 同じ引数に同じ出力を返す。入力検証（重複・競合・選択不可）は呼出し側（shared）の責務だが、
 * 未知のIDは例外とする。
 */
export function generateTrainingTelegrams(
  itemIds: readonly TrainingItemId[],
  options: GenerateOptions,
): GeneratedTrainingTelegram[] {
  const nowMs = Date.parse(options.now);
  if (!Number.isFinite(nowMs)) throw new Error('生成時刻が不正です');
  const ctx: TimeContext = {
    t: Math.floor(nowMs / MINUTE_MS) * MINUTE_MS,
    controlDateTime: formatUtcSeconds(nowMs),
    generationId: options.generationId,
  };
  const selected = new Set<string>(itemIds);
  for (const id of selected) {
    const known =
      findWarningDefinition(id) !== null ||
      BULLETIN_DEFINITIONS.some((definition) => definition.itemId === id) ||
      TORNADO_DEFINITIONS.some((definition) => definition.itemId === id);
    if (!known) throw new Error(`生成対象外の項目です: ${id}`);
  }
  const telegrams: GeneratedTrainingTelegram[] = [];
  for (const telegramType of WARNING_TELEGRAM_ORDER) {
    const definitions = WARNING_DEFINITIONS.filter(
      (definition) =>
        PHENOMENA[definition.phenomenon].telegramType === telegramType &&
        selected.has(definition.itemId),
    );
    if (definitions.length > 0) {
      telegrams.push(generateWarningTelegram(telegramType, definitions, ctx));
    }
  }
  for (const definition of BULLETIN_DEFINITIONS) {
    if (selected.has(definition.itemId)) telegrams.push(generateBulletinTelegram(definition, ctx));
  }
  for (const definition of TORNADO_DEFINITIONS) {
    if (selected.has(definition.itemId)) telegrams.push(generateTornadoTelegram(definition, ctx));
  }
  return telegrams;
}
