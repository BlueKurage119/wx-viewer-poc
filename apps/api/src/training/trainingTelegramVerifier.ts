import { DOMParser, type Element } from '@xmldom/xmldom';
import { parseVphw } from '../polling/jmaVphwParser.js';
import { parseVpbs50 } from '../polling/jmaVpbs50Parser.js';
import { parseWarningTelegram } from '../polling/jmaWarningTelegramParser.js';
import type { TelegramReception } from '../repositories/types.js';
import {
  BULLETIN_DEFINITIONS,
  BULLETIN_INFO_KIND_VERSION,
  TORNADO_DEFINITIONS,
  TRAINING_AREA_MUNICIPAL,
  TRAINING_PARSER_BULLETIN_TARGET,
  TRAINING_PARSER_MUNICIPAL_TARGET,
  WARNING_INFO_KIND_VERSION,
  bulletinEventId,
  expectedPropertyTypes,
  findWarningDefinition,
} from './trainingItemDefinitions.js';
import type { GeneratedTrainingTelegram } from './trainingTelegramGenerator.js';

const NS_REPORT = 'http://xml.kishou.go.jp/jmaxml1/';
const NS_HEAD = 'http://xml.kishou.go.jp/jmaxml1/informationBasis1/';
const NS_BODY = 'http://xml.kishou.go.jp/jmaxml1/body/meteorology1/';

export interface VerifyContext {
  readonly now: string;
  readonly generationId: string;
}

function fail(telegram: GeneratedTrainingTelegram, reason: string): never {
  throw new Error(`訓練電文の生成後検証に失敗しました（${telegram.telegramType}）: ${reason}`);
}

function children(parent: Element, namespaceUri: string, localName: string): Element[] {
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

function childText(parent: Element, namespaceUri: string, localName: string): string | null {
  const found = children(parent, namespaceUri, localName);
  return found.length === 1 ? (found[0]!.textContent ?? '').trim() : null;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** 原文DOM検証。Version・Namespace・Property・EventID規則・時間関係を確認する。 */
function verifyDom(telegram: GeneratedTrainingTelegram, context: VerifyContext): void {
  const root = new DOMParser({
    onError(_level, message) {
      throw new Error(message);
    },
  }).parseFromString(telegram.xml, 'text/xml').documentElement;
  if (!root || root.namespaceURI !== NS_REPORT || root.localName !== 'Report') {
    fail(telegram, 'Report の名前空間が不正です');
  }
  const control = children(root, NS_REPORT, 'Control')[0];
  const head = children(root, NS_HEAD, 'Head')[0];
  const body = children(root, NS_BODY, 'Body')[0];
  if (!control || !head || !body) fail(telegram, 'Control/Head/Body のいずれかがありません');
  if (childText(control, NS_REPORT, 'Status') !== '訓練')
    fail(telegram, 'Control/Status が訓練ではありません');

  const eventId = childText(head, NS_HEAD, 'EventID');
  const version = childText(head, NS_HEAD, 'InfoKindVersion');
  const reportDateTime = Date.parse(childText(head, NS_HEAD, 'ReportDateTime') ?? '');
  if (reportDateTime !== Date.parse(telegram.reportDateTime))
    fail(telegram, '発表時刻が一致しません');

  if (telegram.telegramType === 'VPBS50') {
    const definition = BULLETIN_DEFINITIONS.find(
      (candidate) => candidate.itemId === telegram.itemIds[0],
    );
    if (!definition) fail(telegram, '速報定義が見つかりません');
    if (version !== BULLETIN_INFO_KIND_VERSION) fail(telegram, 'InfoKindVersion が不正です');
    if (eventId !== bulletinEventId(context.generationId, definition)) {
      fail(telegram, 'EventID が訓練用規則に一致しません');
    }
    return;
  }
  if (telegram.telegramType === 'VPHW50' || telegram.telegramType === 'VPHW51') {
    const definition = TORNADO_DEFINITIONS.find(
      (candidate) => candidate.telegramType === telegram.telegramType,
    )!;
    if (version !== definition.version) fail(telegram, 'InfoKindVersion が不正です');
    if (eventId !== '') fail(telegram, 'EventID は空である必要があります');
    const valid = Date.parse(childText(head, NS_HEAD, 'ValidDateTime') ?? '');
    const minutes = (valid - reportDateTime) / 60_000;
    if (!(minutes >= 60 && minutes < 70) || valid % (10 * 60_000) !== 0) {
      fail(telegram, 'ValidDateTime が発表時刻の60〜69分後の10分境界ではありません');
    }
    return;
  }
  // 警報・注意報
  if (version !== WARNING_INFO_KIND_VERSION) fail(telegram, 'InfoKindVersion が不正です');
  if (eventId !== '') fail(telegram, 'EventID は空である必要があります');
  if (childText(head, NS_HEAD, 'Serial') !== '') fail(telegram, 'Serial は空である必要があります');
  const municipal = children(body, NS_BODY, 'Warning').find(
    (warning) => warning.getAttribute('type') === '気象警報・注意報（市町村等）',
  );
  if (!municipal) fail(telegram, '市町村等の Warning がありません');
  const kinds = children(children(municipal, NS_BODY, 'Item')[0]!, NS_BODY, 'Kind');
  if (kinds.length !== telegram.itemIds.length) fail(telegram, '市町村Kindの件数が一致しません');
  kinds.forEach((kind) => {
    const code = childText(kind, NS_BODY, 'Code') ?? '';
    const definition = findWarningDefinition(`warning-${code}`);
    if (!definition) fail(telegram, `未知の種別コードです: ${code}`);
    const types = children(kind, NS_BODY, 'Property').map(
      (property) => childText(property, NS_BODY, 'Type') ?? '',
    );
    if (!sameList(types, expectedPropertyTypes(definition))) {
      fail(telegram, `Property が期待と一致しません: ${code} ${types.join(',')}`);
    }
  });
}

/**
 * 生成したXMLを既存parserに通し、訓練区分・種別・区域・選択コード群・発表時刻の一致を確認する。
 * 不一致は例外（呼出し側で全体失敗にする）。既存parserは変更しない。
 */
export function verifyGeneratedTelegram(
  telegram: GeneratedTrainingTelegram,
  context: VerifyContext,
): void {
  const expected: Pick<
    TelegramReception,
    'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
  > = {
    telegramType: telegram.telegramType,
    controlStatus: 'training',
    reportDateTime: telegram.reportDateTime,
    controlDateTime: new Date(Math.floor(Date.parse(context.now) / 1000) * 1000).toISOString(),
  };
  if (telegram.telegramType === 'VPBS50') {
    const result = parseVpbs50(telegram.xml, expected, TRAINING_PARSER_BULLETIN_TARGET);
    if (!result.ok) fail(telegram, result.reason);
    const definition = BULLETIN_DEFINITIONS.find(
      (candidate) => candidate.itemId === telegram.itemIds[0],
    );
    if (
      !definition ||
      result.value.controlStatus !== 'training' ||
      result.value.informationTag !== definition.condition ||
      result.value.eventId !== bulletinEventId(context.generationId, definition) ||
      result.value.isCancelled ||
      result.value.reportDateTime !== telegram.reportDateTime
    ) {
      fail(telegram, 'parser結果が選択項目と一致しません');
    }
    const codes = result.value.areas.map((area) => area.areaCode);
    const needed =
      definition.kind === 'record-rain' ? ['130010', TRAINING_AREA_MUNICIPAL.code] : ['130010'];
    if (!needed.every((code) => codes.includes(code))) fail(telegram, '区域が一致しません');
  } else if (telegram.telegramType === 'VPHW50' || telegram.telegramType === 'VPHW51') {
    const result = parseVphw(telegram.xml, expected, TRAINING_PARSER_BULLETIN_TARGET);
    if (!result.ok) fail(telegram, result.reason);
    const codes = result.value.areas.map((area) => area.areaCode);
    if (
      result.value.controlStatus !== 'training' ||
      result.value.telegramType !== telegram.telegramType ||
      result.value.isCancelled ||
      result.value.validDateTime !== telegram.validDateTime ||
      result.value.hasSighting !== (telegram.telegramType === 'VPHW51' ? true : null) ||
      !['130000', '130010', '130012', TRAINING_AREA_MUNICIPAL.code].every((code) =>
        codes.includes(code),
      )
    ) {
      fail(telegram, 'parser結果が選択項目と一致しません');
    }
  } else {
    const result = parseWarningTelegram(telegram.xml, expected, TRAINING_PARSER_MUNICIPAL_TARGET);
    if (!result.ok) fail(telegram, result.reason);
    const expectedCodes = telegram.itemIds.map((id) => id.replace('warning-', ''));
    const actualCodes = result.value.kinds.flatMap((kind) =>
      kind.kindType === 'warning' ? [kind.code] : [],
    );
    if (
      result.value.controlStatus !== 'training' ||
      result.value.telegramType !== telegram.telegramType ||
      result.value.area.code !== TRAINING_AREA_MUNICIPAL.code ||
      result.value.targetDateTime !== telegram.targetDateTime ||
      result.value.eventId !== null ||
      result.value.serial !== null ||
      !sameList(actualCodes, expectedCodes) ||
      result.value.kinds.some((kind) => kind.kindType !== 'warning' || kind.status !== '発表')
    ) {
      fail(telegram, 'parser結果が選択項目と一致しません');
    }
  }
  verifyDom(telegram, context);
}
