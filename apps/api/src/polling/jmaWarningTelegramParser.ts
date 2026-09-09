import { DOMParser, type Element } from '@xmldom/xmldom';
import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import {
  WARNING_TELEGRAM_TYPES,
  type ControlStatus,
  type ParsedWarningKind,
  type TelegramReception,
  type WarningTelegramParseResult,
  type WarningTelegramType,
  type WarningTargetArea,
  type XmlFragment,
} from '../repositories/types.js';

export const JMA_REPORT_NAMESPACE = 'http://xml.kishou.go.jp/jmaxml1/';
export const JMA_INFORMATION_NAMESPACE = 'http://xml.kishou.go.jp/jmaxml1/informationBasis1/';
export const JMA_METEOROLOGY_NAMESPACE = 'http://xml.kishou.go.jp/jmaxml1/body/meteorology1/';

// 気象庁「気象警報・注意報（R06）」の提供サンプル（VPWW55–61 / VPWS50）で全種を照合した値。
const MUNICIPAL_WARNING_TYPE = '気象警報・注意報（市町村等）';
const WARNING_TYPE_BY_TELEGRAM: Readonly<Record<WarningTelegramType, string>> = {
  VPWW55: MUNICIPAL_WARNING_TYPE,
  VPWW56: MUNICIPAL_WARNING_TYPE,
  VPWW57: MUNICIPAL_WARNING_TYPE,
  VPWW58: MUNICIPAL_WARNING_TYPE,
  VPWW59: MUNICIPAL_WARNING_TYPE,
  VPWW60: MUNICIPAL_WARNING_TYPE,
  VPWW61: MUNICIPAL_WARNING_TYPE,
  VPWS50: MUNICIPAL_WARNING_TYPE,
};

function parseDocument(rawXml: string): Element | null {
  try {
    return new DOMParser({
      onError(_level, message) {
        throw new Error(message);
      },
    }).parseFromString(rawXml, 'text/xml').documentElement;
  } catch {
    return null;
  }
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

function exactlyOneChild(
  parent: Element,
  namespaceUri: string,
  localName: string,
  path: string,
): { element: Element } | { error: string } {
  const children = directChildren(parent, namespaceUri, localName);
  if (children.length !== 1) {
    return { error: `${path} は1件である必要があります（実際: ${children.length}件）` };
  }
  return { element: children[0]! };
}

function directText(parent: Element, namespaceUri: string, localName: string): string | null {
  const children = directChildren(parent, namespaceUri, localName);
  if (children.length !== 1) return null;
  const text = children[0]!.textContent?.trim();
  return text && text.length > 0 ? text : null;
}

function parseDateTime(raw: string | null): UtcIso8601String | null {
  if (!raw) return null;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(raw);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return null;
  if (zone! !== 'Z') {
    const zoneHour = Number(zone!.slice(1, 3));
    const zoneMinute = Number(zone!.slice(4, 6));
    if (zoneHour > 14 || zoneMinute > 59 || (zoneHour === 14 && zoneMinute !== 0)) return null;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function parseControlStatus(raw: string | null): ControlStatus | null {
  if (raw === '通常') return 'normal';
  if (raw === '訓練') return 'training';
  if (raw === '試験') return 'test';
  return null;
}

function isWarningTelegramType(value: string | null): value is WarningTelegramType {
  return value !== null && (WARNING_TELEGRAM_TYPES as readonly string[]).includes(value);
}

function toFragment(element: Element): XmlFragment {
  const attributes = [];
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index);
    if (attribute) {
      attributes.push({
        namespaceUri: attribute.namespaceURI,
        localName: attribute.localName ?? attribute.nodeName,
        value: attribute.value,
      });
    }
  }
  const children: XmlFragment[] = [];
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = element.childNodes.item(index);
    if (child?.nodeType === 1) children.push(toFragment(child as Element));
  }
  const directTextParts: string[] = [];
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = element.childNodes.item(index);
    if (child?.nodeType === 3 || child?.nodeType === 4) {
      const text = child.textContent?.trim();
      if (text) directTextParts.push(text);
    }
  }
  return {
    namespaceUri: element.namespaceURI!,
    localName: element.localName!,
    attributes,
    text: directTextParts.length > 0 ? directTextParts.join(' ') : null,
    children,
  };
}

function parseKind(kind: Element, sequence: number): ParsedWarningKind | { error: string } {
  const name = directText(kind, JMA_METEOROLOGY_NAMESPACE, 'Name');
  const code = directText(kind, JMA_METEOROLOGY_NAMESPACE, 'Code');
  const status = directText(kind, JMA_METEOROLOGY_NAMESPACE, 'Status');
  if (!status) return { error: 'Body/Warning/Item/Kind/Status は必須です' };

  if (status === '発表警報・注意報はなし') {
    const elements: Element[] = [];
    for (let index = 0; index < kind.childNodes.length; index += 1) {
      const child = kind.childNodes.item(index);
      if (child?.nodeType === 1 && (child as Element).namespaceURI === JMA_METEOROLOGY_NAMESPACE) {
        elements.push(child as Element);
      }
    }
    if (elements.length !== 1 || elements[0]?.localName !== 'Status') {
      return {
        error: 'Body/Warning/Item/Kind の発表警報・注意報はなしは Status だけである必要があります',
      };
    }
    return { kindType: 'no_warning', sequence, status };
  }

  if (!name || !code) return { error: 'Body/Warning/Item/Kind の Name、Code、Status は必須です' };

  const rawDateTime = directText(kind, JMA_METEOROLOGY_NAMESPACE, 'DateTime');
  const dateTime = parseDateTime(rawDateTime);
  if (rawDateTime !== null && dateTime === null)
    return { error: 'Body/Warning/Item/Kind/DateTime が不正です' };

  const lastKinds = directChildren(kind, JMA_METEOROLOGY_NAMESPACE, 'LastKind');
  if (lastKinds.length > 1) return { error: 'Body/Warning/Item/Kind/LastKind は最大1件です' };
  const lastKind = lastKinds[0]
    ? {
        name: directText(lastKinds[0], JMA_METEOROLOGY_NAMESPACE, 'Name'),
        code: directText(lastKinds[0], JMA_METEOROLOGY_NAMESPACE, 'Code'),
      }
    : null;

  const properties = directChildren(kind, JMA_METEOROLOGY_NAMESPACE, 'Property');
  const additions = directChildren(kind, JMA_METEOROLOGY_NAMESPACE, 'Addition');
  if (additions.length > 1) {
    return { error: 'Body/Warning/Item/Kind/Addition は最大1件です' };
  }
  return {
    sequence,
    kindType: 'warning',
    name: name!,
    code: code!,
    status: status!,
    dateTime,
    lastKind,
    properties: properties.map(toFragment),
    addition: additions[0] ? toFragment(additions[0]) : null,
  };
}

function failure(
  disposition: '対象外' | '対象地域外' | '未対応構造',
  reason: string,
): WarningTelegramParseResult {
  return { ok: false, disposition, reason };
}

export function parseWarningTelegram(
  rawXml: string,
  expected: Pick<
    TelegramReception,
    'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
  >,
  targetArea: WarningTargetArea,
): WarningTelegramParseResult {
  if (!isWarningTelegramType(expected.telegramType)) {
    return failure('対象外', `対象外の電文種別です: ${expected.telegramType ?? 'null'}`);
  }
  const root = parseDocument(rawXml);
  if (!root || root.namespaceURI !== JMA_REPORT_NAMESPACE || root.localName !== 'Report') {
    return failure('未対応構造', 'ルート要素 Report の名前空間が不正です');
  }
  const controlResult = exactlyOneChild(root, JMA_REPORT_NAMESPACE, 'Control', 'Report/Control');
  if ('error' in controlResult) return failure('未対応構造', controlResult.error);
  const headResult = exactlyOneChild(root, JMA_INFORMATION_NAMESPACE, 'Head', 'Report/Head');
  if ('error' in headResult) return failure('未対応構造', headResult.error);
  const bodyResult = exactlyOneChild(root, JMA_METEOROLOGY_NAMESPACE, 'Body', 'Report/Body');
  if ('error' in bodyResult) return failure('未対応構造', bodyResult.error);

  const controlStatus = parseControlStatus(
    directText(controlResult.element, JMA_REPORT_NAMESPACE, 'Status'),
  );
  if (!controlStatus) return failure('未対応構造', 'Control/Status が不正です');
  const rawControlDateTime = directText(controlResult.element, JMA_REPORT_NAMESPACE, 'DateTime');
  const controlDateTime = parseDateTime(rawControlDateTime);
  if (!controlDateTime) return failure('未対応構造', 'Control/DateTime が不正です');
  const rawReportDateTime = directText(
    headResult.element,
    JMA_INFORMATION_NAMESPACE,
    'ReportDateTime',
  );
  const reportDateTime = parseDateTime(rawReportDateTime);
  if (!reportDateTime) return failure('未対応構造', 'Head/ReportDateTime が不正です');
  if (
    expected.controlStatus !== controlStatus ||
    expected.controlDateTime !== controlDateTime ||
    expected.reportDateTime !== reportDateTime
  ) {
    return failure('未対応構造', 'C1保存値と Control/Status または日時が一致しません');
  }

  const expectedWarningType = WARNING_TYPE_BY_TELEGRAM[expected.telegramType];
  const matchingWarnings = directChildren(
    bodyResult.element,
    JMA_METEOROLOGY_NAMESPACE,
    'Warning',
  ).filter((warning) => warning.getAttribute('type') === expectedWarningType);
  if (matchingWarnings.length !== 1) {
    return failure(
      '未対応構造',
      `Body/Warning[@type="${expectedWarningType}"] は1件である必要があります（実際: ${matchingWarnings.length}件）`,
    );
  }
  const warning = matchingWarnings[0]!;
  const targetItems = directChildren(warning, JMA_METEOROLOGY_NAMESPACE, 'Item').filter((item) =>
    directChildren(item, JMA_METEOROLOGY_NAMESPACE, 'Area').some(
      (area) => directText(area, JMA_METEOROLOGY_NAMESPACE, 'Code') === targetArea.municipalCode,
    ),
  );
  if (targetItems.length === 0)
    return failure('対象地域外', `対象市町村等コードがありません: ${targetArea.municipalCode}`);

  const area = directChildren(targetItems[0]!, JMA_METEOROLOGY_NAMESPACE, 'Area').find(
    (itemArea) =>
      directText(itemArea, JMA_METEOROLOGY_NAMESPACE, 'Code') === targetArea.municipalCode,
  )!;
  const kinds: ParsedWarningKind[] = [];
  for (const item of targetItems) {
    for (const kind of directChildren(item, JMA_METEOROLOGY_NAMESPACE, 'Kind')) {
      const parsedKind = parseKind(kind, kinds.length + 1);
      if ('error' in parsedKind) return failure('未対応構造', parsedKind.error);
      kinds.push(parsedKind);
    }
  }
  if (kinds.length === 0) return failure('未対応構造', '対象 Item に Kind がありません');

  const rawTargetDateTime = directText(
    headResult.element,
    JMA_INFORMATION_NAMESPACE,
    'TargetDateTime',
  );
  const targetDateTime = parseDateTime(rawTargetDateTime);
  if (rawTargetDateTime !== null && targetDateTime === null) {
    return failure('未対応構造', 'Head/TargetDateTime が不正です');
  }
  return {
    ok: true,
    value: {
      telegramType: expected.telegramType,
      controlStatus,
      reportDateTime,
      controlDateTime,
      targetDateTime,
      infoType: directText(headResult.element, JMA_INFORMATION_NAMESPACE, 'InfoType'),
      eventId: directText(headResult.element, JMA_INFORMATION_NAMESPACE, 'EventID'),
      serial: directText(headResult.element, JMA_INFORMATION_NAMESPACE, 'Serial'),
      area: {
        code: targetArea.municipalCode,
        name: directText(area, JMA_METEOROLOGY_NAMESPACE, 'Name'),
      },
      warningType: expectedWarningType,
      kinds,
    },
  };
}
