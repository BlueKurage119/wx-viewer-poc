import { DOMParser, type Document, type Element, type Node } from '@xmldom/xmldom';
import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import type { ControlStatus, TelegramReceptionAreaInput } from '../repositories/types.js';
import type { AtomFeedEntry } from './jmaXmlFeeds.js';

export const ATOM_NAMESPACE = 'http://www.w3.org/2005/Atom';
export const JMA_BASE_NAMESPACE = 'http://xml.kishou.go.jp/jmaxml1/';
export const JMA_INFO_NAMESPACE = 'http://xml.kishou.go.jp/jmaxml1/informationBasis1/';
export const DEFAULT_ALLOWED_DATA_URL_PREFIX = 'https://www.data.jma.go.jp/developer/xml/data/';

function createStrictDOMParser(): DOMParser {
  return new DOMParser({
    onError(_level, msg) {
      // 警告・エラーを捕捉して例外化
      throw new Error(`XML解析エラー: ${msg}`);
    },
  });
}

function getDirectChildElementsNS(
  parent: Element,
  namespaceURI: string,
  localName: string,
): Element[] {
  const result: Element[] = [];
  const nodes = parent.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes.item(i);
    if (
      node &&
      node.nodeType === 1 && // Element
      (node as Element).namespaceURI === namespaceURI &&
      (node as Element).localName === localName
    ) {
      result.push(node as Element);
    }
  }
  return result;
}

function getDirectChildTextNS(
  parent: Element,
  namespaceURI: string,
  localName: string,
): string | null {
  const elements = getDirectChildElementsNS(parent, namespaceURI, localName);
  const first = elements[0];
  if (!first) {
    return null;
  }
  const text = first.textContent;
  if (!text) {
    return null;
  }
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface ParseAtomFeedOptions {
  readonly allowedUrlPrefixes?: readonly string[];
  readonly allowHttpForTesting?: boolean;
}

export function parseAtomFeed(
  xmlText: string,
  options?: ParseAtomFeedOptions,
): readonly AtomFeedEntry[] {
  const parser = createStrictDOMParser();
  let doc: Document;
  try {
    doc = parser.parseFromString(xmlText, 'text/xml');
  } catch (error) {
    throw new Error(`AtomフィードのXML解析に失敗しました: ${String(error)}`);
  }

  const root = doc.documentElement;
  if (!root || root.namespaceURI !== ATOM_NAMESPACE || root.localName !== 'feed') {
    throw new Error(
      'Atomフィードのルート要素が <feed xmlns="http://www.w3.org/2005/Atom"> ではありません',
    );
  }

  const entryElements = root.getElementsByTagNameNS(ATOM_NAMESPACE, 'entry');
  const entries: AtomFeedEntry[] = [];

  const allowedPrefixes = options?.allowedUrlPrefixes ?? [DEFAULT_ALLOWED_DATA_URL_PREFIX];
  const allowHttp = options?.allowHttpForTesting ?? false;

  for (let i = 0; i < entryElements.length; i++) {
    const entryEl = entryElements.item(i) as Element;
    const id = getDirectChildTextNS(entryEl, ATOM_NAMESPACE, 'id');
    const title = getDirectChildTextNS(entryEl, ATOM_NAMESPACE, 'title');
    const summary = getDirectChildTextNS(entryEl, ATOM_NAMESPACE, 'summary');

    const linkElements = getDirectChildElementsNS(entryEl, ATOM_NAMESPACE, 'link');
    if (linkElements.length === 0) {
      throw new Error(`Atomエントリ (${id ?? title ?? i}) に link 要素が存在しません`);
    }

    // link 要素から href 属性を抽出
    let documentUrl: string | null = null;
    for (const linkEl of linkElements) {
      const href = linkEl.getAttribute('href');
      if (href && href.trim().length > 0) {
        documentUrl = href.trim();
        break;
      }
    }

    if (!documentUrl) {
      throw new Error(`Atomエントリ (${id ?? title ?? i}) の link に href が存在しません`);
    }

    // URLの安全性と形式を検証
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(documentUrl);
    } catch {
      throw new Error(`Atomエントリの link URL が不正です: ${documentUrl}`);
    }

    if (!allowHttp && parsedUrl.protocol !== 'https:') {
      throw new Error(`Atomエントリの link URL が HTTPS ではありません: ${documentUrl}`);
    }

    const matchesPrefix = allowedPrefixes.some((prefix) => documentUrl!.startsWith(prefix));
    if (!matchesPrefix) {
      throw new Error(
        `Atomエントリの link URL が許可されたプレフィックス配下ではありません: ${documentUrl}`,
      );
    }

    entries.push({
      id,
      title,
      summary,
      documentUrl,
    });
  }

  return entries;
}

export interface ParsedTelegram {
  readonly isValidEnvelope: boolean;
  readonly validationErrorReason: string | null;
  readonly telegramType: string | null;
  readonly title: string | null;
  readonly controlStatus: ControlStatus | null;
  readonly infoType: string | null;
  readonly eventId: string | null;
  readonly serial: string | null;
  readonly controlDateTime: UtcIso8601String | null;
  readonly reportDateTime: UtcIso8601String | null;
  readonly targetDateTime: UtcIso8601String | null;
  readonly areas: readonly TelegramReceptionAreaInput[];
}

function parseIsoToUtcString(rawIso: string | null): UtcIso8601String | null {
  if (!rawIso) return null;
  try {
    const d = new Date(rawIso);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

export function extractTelegramTypeFromUrl(url: string): string | null {
  const match = url.match(/_([A-Z]{4}\d{2})_/);
  return match && match[1] ? match[1] : null;
}

export function parseTelegramXml(xmlText: string, documentUrl: string): ParsedTelegram {
  const telegramType = extractTelegramTypeFromUrl(documentUrl);

  const parser = createStrictDOMParser();
  let doc: Document;
  try {
    doc = parser.parseFromString(xmlText, 'text/xml');
  } catch (err) {
    return {
      isValidEnvelope: false,
      validationErrorReason: `XML構文エラー: ${String(err)}`,
      telegramType,
      title: null,
      controlStatus: null,
      infoType: null,
      eventId: null,
      serial: null,
      controlDateTime: null,
      reportDateTime: null,
      targetDateTime: null,
      areas: [],
    };
  }

  const root = doc.documentElement;
  if (!root || root.namespaceURI !== JMA_BASE_NAMESPACE || root.localName !== 'Report') {
    return {
      isValidEnvelope: false,
      validationErrorReason:
        'ルート要素が <Report xmlns="http://xml.kishou.go.jp/jmaxml1/"> ではありません',
      telegramType,
      title: null,
      controlStatus: null,
      infoType: null,
      eventId: null,
      serial: null,
      controlDateTime: null,
      reportDateTime: null,
      targetDateTime: null,
      areas: [],
    };
  }

  // 1. Control 要素の検証
  const controlElements = getDirectChildElementsNS(root, JMA_BASE_NAMESPACE, 'Control');
  if (controlElements.length === 0) {
    return {
      isValidEnvelope: false,
      validationErrorReason: 'Control要素が存在しません',
      telegramType,
      title: null,
      controlStatus: null,
      infoType: null,
      eventId: null,
      serial: null,
      controlDateTime: null,
      reportDateTime: null,
      targetDateTime: null,
      areas: [],
    };
  }
  const controlEl = controlElements[0];
  if (!controlEl) {
    return {
      isValidEnvelope: false,
      validationErrorReason: 'Control要素が存在しません',
      telegramType,
      title: null,
      controlStatus: null,
      infoType: null,
      eventId: null,
      serial: null,
      controlDateTime: null,
      reportDateTime: null,
      targetDateTime: null,
      areas: [],
    };
  }

  const rawStatus = getDirectChildTextNS(controlEl, JMA_BASE_NAMESPACE, 'Status');
  let controlStatus: ControlStatus | null = null;
  if (rawStatus === '通常') {
    controlStatus = 'normal';
  } else if (rawStatus === '訓練') {
    controlStatus = 'training';
  } else if (rawStatus === '試験') {
    controlStatus = 'test';
  } else {
    return {
      isValidEnvelope: false,
      validationErrorReason: `Control/Statusが不正または未対応です: ${rawStatus ?? 'null'}`,
      telegramType,
      title: null,
      controlStatus: null,
      infoType: null,
      eventId: null,
      serial: null,
      controlDateTime: null,
      reportDateTime: null,
      targetDateTime: null,
      areas: [],
    };
  }

  const rawControlDateTime = getDirectChildTextNS(controlEl, JMA_BASE_NAMESPACE, 'DateTime');
  const controlDateTime = parseIsoToUtcString(rawControlDateTime);
  if (!controlDateTime) {
    return {
      isValidEnvelope: false,
      validationErrorReason: `Control/DateTimeが不正です: ${rawControlDateTime ?? 'null'}`,
      telegramType,
      title: null,
      controlStatus,
      infoType: null,
      eventId: null,
      serial: null,
      controlDateTime: null,
      reportDateTime: null,
      targetDateTime: null,
      areas: [],
    };
  }

  // 2. Head 要素の検証
  const headElements = getDirectChildElementsNS(root, JMA_INFO_NAMESPACE, 'Head');
  const headEl = headElements[0];
  if (!headEl) {
    return {
      isValidEnvelope: false,
      validationErrorReason: 'Head要素が存在しません',
      telegramType,
      title: null,
      controlStatus,
      infoType: null,
      eventId: null,
      serial: null,
      controlDateTime,
      reportDateTime: null,
      targetDateTime: null,
      areas: [],
    };
  }

  const title = getDirectChildTextNS(headEl, JMA_INFO_NAMESPACE, 'Title');
  const rawReportDateTime = getDirectChildTextNS(headEl, JMA_INFO_NAMESPACE, 'ReportDateTime');
  const reportDateTime = parseIsoToUtcString(rawReportDateTime);
  if (!reportDateTime) {
    return {
      isValidEnvelope: false,
      validationErrorReason: `Head/ReportDateTimeが不正です: ${rawReportDateTime ?? 'null'}`,
      telegramType,
      title,
      controlStatus,
      infoType: null,
      eventId: null,
      serial: null,
      controlDateTime,
      reportDateTime: null,
      targetDateTime: null,
      areas: [],
    };
  }

  const rawTargetDateTime = getDirectChildTextNS(headEl, JMA_INFO_NAMESPACE, 'TargetDateTime');
  const targetDateTime = parseIsoToUtcString(rawTargetDateTime);

  const eventId = getDirectChildTextNS(headEl, JMA_INFO_NAMESPACE, 'EventID');
  const serial = getDirectChildTextNS(headEl, JMA_INFO_NAMESPACE, 'Serial');
  const infoType = getDirectChildTextNS(headEl, JMA_INFO_NAMESPACE, 'InfoType');

  // 3. 地域要素（Area）の抽出と検証
  function findElementsByLocalName(element: Element, targetLocalName: string): Element[] {
    const list: Element[] = [];
    function traverse(node: Node) {
      if (node.nodeType === 1) {
        const el = node as Element;
        if (el.localName === targetLocalName) {
          list.push(el);
        }
      }
      const children = node.childNodes;
      for (let i = 0; i < children.length; i++) {
        const child = children.item(i);
        if (child) traverse(child);
      }
    }
    traverse(element);
    return list;
  }

  const allAreaElements = findElementsByLocalName(root, 'Area');
  const areas: TelegramReceptionAreaInput[] = [];
  const seenAreaKeys = new Set<string>();

  for (const areaEl of allAreaElements) {
    // 子の Name と Code を探す
    let code: string | null = null;
    let name: string | null = null;

    const childNodes = areaEl.childNodes;
    for (let c = 0; c < childNodes.length; c++) {
      const child = childNodes.item(c);
      if (child && child.nodeType === 1) {
        const el = child as Element;
        if (el.localName === 'Code') {
          const t = el.textContent?.trim();
          if (t && t.length > 0) code = t;
        } else if (el.localName === 'Name') {
          const t = el.textContent?.trim();
          if (t && t.length > 0) name = t;
        }
      }
    }

    if (code) {
      // 親要素が Areas で codeType を持っているか
      let codeType: string | null = null;
      const parentNode = areaEl.parentNode;
      if (parentNode && parentNode.nodeType === 1) {
        const parentEl = parentNode as Element;
        if (parentEl.localName === 'Areas') {
          const ct = parentEl.getAttribute('codeType');
          if (ct && ct.trim().length > 0) {
            codeType = ct.trim();
          }
        }
      }

      const key = `${code}:${codeType ?? ''}`;
      if (!seenAreaKeys.has(key)) {
        seenAreaKeys.add(key);
        areas.push({
          areaCode: code,
          areaName: name,
          codeType,
          sequence: areas.length + 1,
        });
      }
    }
  }

  if (areas.length === 0) {
    return {
      isValidEnvelope: false,
      validationErrorReason: '地域要素（Area/Code）が存在しません',
      telegramType,
      title,
      controlStatus,
      infoType,
      eventId,
      serial,
      controlDateTime,
      reportDateTime,
      targetDateTime,
      areas: [],
    };
  }

  return {
    isValidEnvelope: true,
    validationErrorReason: null,
    telegramType,
    title,
    controlStatus,
    infoType,
    eventId,
    serial,
    controlDateTime,
    reportDateTime,
    targetDateTime,
    areas,
  };
}
