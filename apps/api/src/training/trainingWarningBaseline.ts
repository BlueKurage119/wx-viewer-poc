import { DOMParser, type Element } from '@xmldom/xmldom';
import { parseWarningTelegram } from '../polling/jmaWarningTelegramParser.js';
import {
  TRAINING_AREA_MUNICIPAL,
  TRAINING_PARSER_MUNICIPAL_TARGET,
  WARNING_INFORMATION_TIERS,
} from './trainingItemDefinitions.js';
import { formatJst, formatUtcSeconds } from './trainingTelegramGenerator.js';
import { el, serializeXml, type XmlNode } from './trainingXmlBuilder.js';

const NS_REPORT = 'http://xml.kishou.go.jp/jmaxml1/';
const NS_HEAD = 'http://xml.kishou.go.jp/jmaxml1/informationBasis1/';
const NS_BODY = 'http://xml.kishou.go.jp/jmaxml1/body/meteorology1/';

const BASELINE_CONTROL_TITLE = '気象警報・注意報（Ｒ０６）（集約通報）';
const BASELINE_HEAD_TITLE = '警戒・注意事項集約定時通報';
const BASELINE_INFO_KIND = '気象警報・注意報';
const BASELINE_INFO_KIND_VERSION = '1.5_0';
const BASELINE_TRAINING_BANNER = '＊＊＊これは訓練です＊＊＊';
const NO_WARNING_STATUS = '発表警報・注意報はなし';

export interface TrainingWarningBaselineOptions {
  /** 発表時刻 Tb（UTC ISO または epoch ms）。 */
  readonly reportDateTime: string;
  /** Control/DateTime（UTC ISO または epoch ms）。 */
  readonly controlDateTime: string;
}

function simple(name: string, text: string): XmlNode {
  return el(name, null, text);
}

/**
 * 訓練用 VPWS50 基準電文（発表中の警報・注意報なし）を生成する。
 * 純粋処理（DB・ネットワーク不要）。
 */
export function generateTrainingWarningBaseline(options: TrainingWarningBaselineOptions): string {
  const reportMs = Date.parse(options.reportDateTime);
  if (Number.isNaN(reportMs)) throw new Error('Invalid reportDateTime');
  const controlMs = Date.parse(options.controlDateTime);
  if (Number.isNaN(controlMs)) throw new Error('Invalid controlDateTime');

  const tbJst = formatJst(reportMs);
  const controlUtc = formatUtcSeconds(controlMs);

  const control = el(
    'Control',
    null,
    simple('Title', BASELINE_CONTROL_TITLE),
    simple('DateTime', controlUtc),
    simple('Status', '訓練'),
    simple('EditorialOffice', '気象庁'),
    simple('PublishingOffice', '気象庁'),
  );

  const head = el(
    'Head',
    { xmlns: NS_HEAD },
    simple('Title', BASELINE_HEAD_TITLE),
    simple('ReportDateTime', tbJst),
    simple('TargetDateTime', tbJst),
    el('EventID', null),
    simple('InfoType', '発表'),
    el('Serial', null),
    simple('InfoKind', BASELINE_INFO_KIND),
    simple('InfoKindVersion', BASELINE_INFO_KIND_VERSION),
    el('Headline', null, simple('Text', BASELINE_TRAINING_BANNER)),
  );

  const warnings: XmlNode[] = WARNING_INFORMATION_TIERS.map((tier) => {
    const isMunicipal = tier.area.code === TRAINING_AREA_MUNICIPAL.code;
    const kindChildren: XmlNode[] = [simple('Status', NO_WARNING_STATUS)];
    if (isMunicipal) {
      kindChildren.push(el('DateTime', { type: '発表時刻' }, tbJst));
    }

    return el(
      'Warning',
      { type: tier.type },
      el(
        'Item',
        null,
        el('Kind', null, ...kindChildren),
        el('Area', null, simple('Name', tier.area.name), simple('Code', tier.area.code)),
      ),
    );
  });

  const body = el('Body', { xmlns: NS_BODY }, ...warnings);

  const root = el('Report', { xmlns: NS_REPORT, 'xmlns:jmx': NS_REPORT }, control, head, body);

  return serializeXml(root);
}

function directChildren(parent: Element, namespaceUri: string, localName: string): Element[] {
  const result: Element[] = [];
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const node = parent.childNodes.item(index);
    if (
      node?.nodeType === 1 &&
      (node as Element).namespaceURI === namespaceUri &&
      (node as Element).localName === localName
    ) {
      result.push(node as Element);
    }
  }
  return result;
}

function directText(parent: Element, namespaceUri: string, localName: string): string | null {
  const found = directChildren(parent, namespaceUri, localName);
  return found.length === 1 ? (found[0]!.textContent ?? '').trim() : null;
}

/**
 * 訓練用 VPWS50 基準電文を検証する。不合格なら例外を投げる。
 */
export function verifyTrainingWarningBaseline(
  xml: string,
  options: TrainingWarningBaselineOptions,
): void {
  const reportIso = new Date(options.reportDateTime).toISOString();
  const controlIso = new Date(options.controlDateTime).toISOString();

  // 1. 既存 parseWarningTelegram による検証
  const parseResult = parseWarningTelegram(
    xml,
    {
      telegramType: 'VPWS50',
      controlStatus: 'training',
      reportDateTime: reportIso,
      controlDateTime: controlIso,
    },
    TRAINING_PARSER_MUNICIPAL_TARGET,
  );

  if (!parseResult.ok) {
    throw new Error(
      `訓練用基準電文の検証に失敗しました（parser不合格）: ${parseResult.reason} (${parseResult.disposition})`,
    );
  }

  const parsed = parseResult.value;
  if (parsed.controlStatus !== 'training') {
    throw new Error('controlStatus が training ではありません');
  }
  if (parsed.telegramType !== 'VPWS50') {
    throw new Error('telegramType が VPWS50 ではありません');
  }
  if (parsed.area.code !== TRAINING_AREA_MUNICIPAL.code) {
    throw new Error(`area.code が ${TRAINING_AREA_MUNICIPAL.code} ではありません`);
  }
  if (parsed.kinds.length !== 1) {
    throw new Error(`kinds 件数が 1 ではありません（実際: ${parsed.kinds.length}件）`);
  }
  const kind = parsed.kinds[0]!;
  if (kind.kindType !== 'no_warning') {
    throw new Error('kindType が no_warning ではありません');
  }
  if (kind.dateTime !== reportIso) {
    throw new Error(
      `kind.dateTime (${kind.dateTime}) が reportDateTime (${reportIso}) と一致しません`,
    );
  }
  if (parsed.eventId !== null) {
    throw new Error('eventId は null である必要があります');
  }
  if (parsed.serial !== null) {
    throw new Error('serial は null である必要があります');
  }

  // 2. 原文DOM検証
  const root = new DOMParser({
    onError(_level, message) {
      throw new Error(message);
    },
  }).parseFromString(xml, 'text/xml').documentElement;

  if (!root || root.namespaceURI !== NS_REPORT || root.localName !== 'Report') {
    throw new Error('ルート要素 Report の名前空間が不正です');
  }

  const controls = directChildren(root, NS_REPORT, 'Control');
  if (controls.length !== 1) throw new Error('Control が1件ではありません');
  const control = controls[0]!;
  if (directText(control, NS_REPORT, 'Status') !== '訓練') {
    throw new Error('Control/Status が「訓練」ではありません');
  }

  const heads = directChildren(root, NS_HEAD, 'Head');
  if (heads.length !== 1) throw new Error('Head が1件ではありません');
  const head = heads[0]!;
  if (directText(head, NS_HEAD, 'InfoKindVersion') !== BASELINE_INFO_KIND_VERSION) {
    throw new Error(`InfoKindVersion が ${BASELINE_INFO_KIND_VERSION} ではありません`);
  }

  const headlines = directChildren(head, NS_HEAD, 'Headline');
  if (headlines.length !== 1) throw new Error('Headline が1件ではありません');
  const headlineText = directText(headlines[0]!, NS_HEAD, 'Text');
  const firstLine = headlineText?.split('\n')[0]?.trim();
  if (firstLine !== BASELINE_TRAINING_BANNER) {
    throw new Error(`Headline/Text の1行目が「${BASELINE_TRAINING_BANNER}」ではありません`);
  }
  if (directChildren(headlines[0]!, NS_HEAD, 'Information').length > 0) {
    throw new Error('Headline/Information が存在してはなりません');
  }

  const bodies = directChildren(root, NS_BODY, 'Body');
  if (bodies.length !== 1) throw new Error('Body が1件ではありません');
  const body = bodies[0]!;

  const warnings = directChildren(body, NS_BODY, 'Warning');
  if (warnings.length !== 4) {
    throw new Error(`Body/Warning が 4件 ではありません（実際: ${warnings.length}件）`);
  }

  const expectedTiers = WARNING_INFORMATION_TIERS;
  for (let i = 0; i < 4; i++) {
    const warning = warnings[i]!;
    const tier = expectedTiers[i]!;
    if (warning.getAttribute('type') !== tier.type) {
      throw new Error(`Warning[${i}] の type が「${tier.type}」ではありません`);
    }
    const items = directChildren(warning, NS_BODY, 'Item');
    if (items.length !== 1) {
      throw new Error(`Warning[${i}] の Item が 1件 ではありません`);
    }
    const item = items[0]!;
    const area = directChildren(item, NS_BODY, 'Area')[0];
    if (!area) throw new Error(`Warning[${i}] の Item/Area がありません`);
    if (directText(area, NS_BODY, 'Code') !== tier.area.code) {
      throw new Error(`Warning[${i}] の Area/Code が「${tier.area.code}」ではありません`);
    }
    if (directText(area, NS_BODY, 'Name') !== tier.area.name) {
      throw new Error(`Warning[${i}] の Area/Name が「${tier.area.name}」ではありません`);
    }
    const kindNode = directChildren(item, NS_BODY, 'Kind')[0];
    if (!kindNode) throw new Error(`Warning[${i}] の Item/Kind がありません`);
    if (directText(kindNode, NS_BODY, 'Status') !== NO_WARNING_STATUS) {
      throw new Error(`Warning[${i}] の Kind/Status が「${NO_WARNING_STATUS}」ではありません`);
    }
    const dateTimeNode = directChildren(kindNode, NS_BODY, 'DateTime');
    if (tier.area.code === TRAINING_AREA_MUNICIPAL.code) {
      if (dateTimeNode.length !== 1) {
        throw new Error('市町村等層の Kind/DateTime が 1件 ではありません');
      }
      if (dateTimeNode[0]!.getAttribute('type') !== '発表時刻') {
        throw new Error('市町村等層の Kind/DateTime/@type が「発表時刻」ではありません');
      }
    } else {
      if (dateTimeNode.length !== 0) {
        throw new Error('上位層の Kind/DateTime が存在してはなりません');
      }
    }
  }
}
