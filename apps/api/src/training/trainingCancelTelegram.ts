import { DOMParser, XMLSerializer, type Document, type Element } from '@xmldom/xmldom';
import type { BosaiBulletinTarget } from '../repositories/types.js';
import { parseTelegramXml } from '../polling/jmaXmlFeedParser.js';
import { parseVphw } from '../polling/jmaVphwParser.js';
import { parseVpbs50 } from '../polling/jmaVpbs50Parser.js';
import { parseWarningTelegram } from '../polling/jmaWarningTelegramParser.js';
import {
  TRAINING_PARSER_BULLETIN_TARGET,
  TRAINING_PARSER_MUNICIPAL_TARGET,
} from './trainingItemDefinitions.js';

/**
 * 訓練取消電文の合成（Issue #71 J3）。
 * 取消対象の受信原文を DOM で読み、Head/InfoType と Control/DateTime の2要素だけを書き換える。
 * 文字列の正規表現置換はしない。合成取消は気象庁の実取消電文の形の再現ではない（AD-H043）。
 */

const CANCEL_INFO_TYPE = '取消';

function parseStrict(xml: string): Document {
  return new DOMParser({
    onError(_level, message) {
      throw new Error(message);
    },
  }).parseFromString(xml, 'text/xml');
}

function directChildrenByLocalName(parent: Element, localName: string): Element[] {
  const result: Element[] = [];
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const node = parent.childNodes.item(index);
    if (node?.nodeType === 1 && (node as Element).localName === localName) {
      result.push(node as Element);
    }
  }
  return result;
}

function onlyChild(parent: Element, localName: string): Element {
  const found = directChildrenByLocalName(parent, localName);
  if (found.length !== 1) {
    throw new Error(`${parent.localName}/${localName} が1件ではありません（${found.length}件）`);
  }
  return found[0]!;
}

function locateTargets(doc: Document): { infoType: Element; controlDateTime: Element } {
  const root = doc.documentElement;
  if (!root || root.localName !== 'Report') throw new Error('ルート要素 Report がありません');
  const control = onlyChild(root, 'Control');
  const head = onlyChild(root, 'Head');
  return { infoType: onlyChild(head, 'InfoType'), controlDateTime: onlyChild(control, 'DateTime') };
}

function serialize(doc: Document, original: string): string {
  const body = new XMLSerializer().serializeToString(doc);
  // xmldom は XML 宣言を保持しないため、原文にあれば先頭に戻す。
  const declaration = /^\s*(<\?xml[^?]*\?>)/.exec(original);
  if (declaration && !body.startsWith('<?xml')) return `${declaration[1]}\n${body}`;
  return body;
}

export interface BuildTrainingCancelOptions {
  /** Control/DateTime に書く時刻（UTC ISO。秒に切り捨てて `Z` で書き出す）。 */
  readonly controlDateTime: string;
}

export function formatCancelControlDateTime(value: string): string {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error('controlDateTime が不正です');
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function buildTrainingCancelTelegram(
  rawXml: string,
  options: BuildTrainingCancelOptions,
): string {
  const doc = parseStrict(rawXml);
  const { infoType, controlDateTime } = locateTargets(doc);
  infoType.textContent = CANCEL_INFO_TYPE;
  controlDateTime.textContent = formatCancelControlDateTime(options.controlDateTime);
  return serialize(doc, rawXml);
}

export interface VerifyTrainingCancelOptions {
  readonly documentUrl: string;
  readonly telegramType: string;
  /** 元の電文から求めた EventID。速報（VPBS50・VPHW50/51）のみ指定する。 */
  readonly expectedEventId?: string | null;
  /** 速報 parser に渡す対象区域。省略時は訓練用の固定値。 */
  readonly bulletinTarget?: BosaiBulletinTarget;
  /** 元の受信原文。指定すると InfoType・Control/DateTime 以外が一致することも確かめる。 */
  readonly originalXml?: string;
}

function normalizedWithoutRewrittenElements(xml: string): string {
  const doc = parseStrict(xml);
  const { infoType, controlDateTime } = locateTargets(doc);
  infoType.textContent = '';
  controlDateTime.textContent = '';
  return new XMLSerializer().serializeToString(doc);
}

/** 投入前検証。不合格なら例外を投げる。 */
export function verifyTrainingCancelTelegram(
  xml: string,
  options: VerifyTrainingCancelOptions,
): void {
  const envelope = parseTelegramXml(xml, options.documentUrl);
  if (!envelope.isValidEnvelope) {
    throw new Error(`取消電文のエンベロープが不正です: ${envelope.validationErrorReason}`);
  }
  if (envelope.infoType !== CANCEL_INFO_TYPE)
    throw new Error('取消電文の InfoType が取消ではありません');
  if (envelope.controlStatus !== 'training') {
    throw new Error('取消電文の Control/Status が訓練ではありません');
  }
  if (envelope.telegramType !== options.telegramType) {
    throw new Error('取消電文の電文種別が一致しません');
  }
  if (!envelope.controlDateTime || !envelope.reportDateTime) {
    throw new Error('取消電文の時刻が読み取れません');
  }
  // VPHW の EventID は parser が合成する値のため、下の parser 照合で確かめる
  if (
    options.telegramType === 'VPBS50' &&
    options.expectedEventId !== undefined &&
    options.expectedEventId !== null
  ) {
    if (envelope.eventId !== options.expectedEventId) {
      throw new Error('取消電文の EventID が元の電文と一致しません');
    }
  }
  if (options.originalXml !== undefined) {
    if (
      normalizedWithoutRewrittenElements(options.originalXml) !==
      normalizedWithoutRewrittenElements(xml)
    ) {
      throw new Error('取消電文が元の電文と InfoType・Control/DateTime 以外で異なります');
    }
  }

  const expected = {
    telegramType: options.telegramType,
    controlStatus: 'training' as const,
    reportDateTime: envelope.reportDateTime,
    controlDateTime: envelope.controlDateTime,
  };
  if (options.telegramType.startsWith('VPWW') || options.telegramType === 'VPWS50') {
    const result = parseWarningTelegram(xml, expected, TRAINING_PARSER_MUNICIPAL_TARGET);
    if (!result.ok) throw new Error(`取消電文が警報 parser で不合格です: ${result.reason}`);
    if (result.value.infoType !== CANCEL_INFO_TYPE)
      throw new Error('parser の infoType が取消ではありません');
    return;
  }
  if (options.telegramType === 'VPBS50') {
    const result = parseVpbs50(
      xml,
      expected,
      options.bulletinTarget ?? TRAINING_PARSER_BULLETIN_TARGET,
    );
    if (!result.ok) throw new Error(`取消電文が VPBS50 parser で不合格です: ${result.reason}`);
    if (!result.value.isCancelled) throw new Error('parser の取消判定が偽です');
    return;
  }
  if (options.telegramType === 'VPHW50' || options.telegramType === 'VPHW51') {
    const result = parseVphw(
      xml,
      expected,
      options.bulletinTarget ?? TRAINING_PARSER_BULLETIN_TARGET,
    );
    if (!result.ok) throw new Error(`取消電文が VPHW parser で不合格です: ${result.reason}`);
    if (!result.value.isCancelled) throw new Error('parser の取消判定が偽です');
    if (
      options.expectedEventId !== undefined &&
      options.expectedEventId !== null &&
      result.value.eventId !== options.expectedEventId
    ) {
      throw new Error('取消電文の VPHW 合成キーが元の電文と一致しません');
    }
    return;
  }
  throw new Error(`未対応の電文種別です: ${options.telegramType}`);
}
