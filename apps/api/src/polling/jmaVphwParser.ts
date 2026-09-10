import { DOMParser, type Element } from '@xmldom/xmldom';
import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import {
  VPHW50_TELEGRAM_TYPE,
  VPHW51_TELEGRAM_TYPE,
  VPHW_EXPECTED_CONTROL_TITLES,
  VPHW_EXPECTED_INFO_KIND,
  VPHW_REQUIRED_INFORMATION_TYPES,
  VPHW_SIGHTING_INFORMATION_TYPE,
  type BosaiBulletinAreaInput,
  type BosaiBulletinTarget,
  type ControlStatus,
  type ParsedVphw,
  type TelegramReception,
  type VphwParseResult,
  type VphwTelegramType,
} from '../repositories/types.js';
import {
  DEFAULT_BOSAI_BULLETIN_TARGET,
  resolveBosaiBulletinTarget,
} from '../venueForecastTargets.js';

export {
  DEFAULT_BOSAI_BULLETIN_TARGET,
  resolveBosaiBulletinTarget,
  type ParsedVphw,
  type VphwParseResult,
};

export const JMA_REPORT_NAMESPACE = 'http://xml.kishou.go.jp/jmaxml1/';
export const JMA_INFORMATION_NAMESPACE = 'http://xml.kishou.go.jp/jmaxml1/informationBasis1/';

const KNOWN_INFORMATION_TYPES = new Set<string>([
  ...VPHW_REQUIRED_INFORMATION_TYPES,
  VPHW_SIGHTING_INFORMATION_TYPE,
]);

export function isVphwTelegramType(telegramType: string | null): telegramType is VphwTelegramType {
  return telegramType === VPHW50_TELEGRAM_TYPE || telegramType === VPHW51_TELEGRAM_TYPE;
}

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

export function parseVphw(
  rawXml: string,
  expected: Pick<
    TelegramReception,
    'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
  >,
  target: BosaiBulletinTarget = DEFAULT_BOSAI_BULLETIN_TARGET,
): VphwParseResult {
  // 判定#1: 電文種別チェック
  if (!isVphwTelegramType(expected.telegramType)) {
    return {
      ok: false,
      disposition: '対象外',
      reason: `VPHW50 / VPHW51 以外の電文種別です: ${expected.telegramType}`,
    };
  }

  const telegramType = expected.telegramType;

  // 判定#2: XML ドキュメントパースと Report ルート検証
  const root = parseDocument(rawXml);
  if (!root || root.namespaceURI !== JMA_REPORT_NAMESPACE || root.localName !== 'Report') {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: 'Report ルート要素が不正です',
    };
  }

  // Control の検証
  const controlChild = exactlyOneChild(root, JMA_REPORT_NAMESPACE, 'Control', 'Report/Control');
  if ('error' in controlChild) {
    return { ok: false, disposition: '未対応構造', reason: controlChild.error };
  }
  const control = controlChild.element;

  // 判定#4: Control/Title が電文種別に対応する値であるか検証
  const expectedControlTitle = VPHW_EXPECTED_CONTROL_TITLES[telegramType];
  const controlTitle = directText(control, JMA_REPORT_NAMESPACE, 'Title');
  if (!controlTitle) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: 'Control/Title が見つかりません',
    };
  }
  if (controlTitle !== expectedControlTitle) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: `Control/Title (${controlTitle}) が電文種別 (${telegramType}) の期待値 (${expectedControlTitle}) と一致しません`,
    };
  }

  // 判定#5: Control/Status 検証
  const statusText = directText(control, JMA_REPORT_NAMESPACE, 'Status');
  const controlStatus = parseControlStatus(statusText);
  if (!controlStatus || controlStatus !== expected.controlStatus) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: `Control/Status (${statusText}) が expected (${expected.controlStatus}) と一致しません`,
    };
  }

  // 判定#5: Control/DateTime 検証
  const dateTimeText = directText(control, JMA_REPORT_NAMESPACE, 'DateTime');
  const controlDateTime = parseDateTime(dateTimeText);
  if (!controlDateTime || controlDateTime !== expected.controlDateTime) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: `Control/DateTime (${dateTimeText} -> ${controlDateTime}) が expected (${expected.controlDateTime}) と一致しません`,
    };
  }

  // Head の検証
  const headChild = exactlyOneChild(root, JMA_INFORMATION_NAMESPACE, 'Head', 'Report/Head');
  if ('error' in headChild) {
    return { ok: false, disposition: '未対応構造', reason: headChild.error };
  }
  const head = headChild.element;

  // 判定#3: Head/InfoKind が 竜巻注意情報 であるか検証
  const infoKind = directText(head, JMA_INFORMATION_NAMESPACE, 'InfoKind');
  if (infoKind !== VPHW_EXPECTED_INFO_KIND) {
    return {
      ok: false,
      disposition: '対象外',
      reason: `Head/InfoKind (${infoKind}) が想定 (${VPHW_EXPECTED_INFO_KIND}) と一致しません`,
    };
  }

  const title = directText(head, JMA_INFORMATION_NAMESPACE, 'Title');
  if (!title) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: 'Head/Title が見つかりません',
    };
  }

  // 判定#5: Head/ReportDateTime 検証
  const reportDateTimeText = directText(head, JMA_INFORMATION_NAMESPACE, 'ReportDateTime');
  const reportDateTime = parseDateTime(reportDateTimeText);
  if (!reportDateTime || reportDateTime !== expected.reportDateTime) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: `Head/ReportDateTime (${reportDateTimeText} -> ${reportDateTime}) が expected (${expected.reportDateTime}) と一致しません`,
    };
  }

  const infoType = directText(head, JMA_INFORMATION_NAMESPACE, 'InfoType');
  if (!infoType) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: 'Head/InfoType が見つかりません',
    };
  }
  const isCancelled = infoType === '取消';

  // 判定#6: Head/ValidDateTime 検証（取消のみ null 許容）
  const validDateTimeText = directText(head, JMA_INFORMATION_NAMESPACE, 'ValidDateTime');
  let validDateTime: UtcIso8601String | null = null;
  if (validDateTimeText) {
    validDateTime = parseDateTime(validDateTimeText);
    if (!validDateTime) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `Head/ValidDateTime (${validDateTimeText}) が日時として解釈不能です`,
      };
    }
  } else {
    if (!isCancelled) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: 'Head/ValidDateTime が見つかりません',
      };
    }
  }

  const infoKindVersion = directText(head, JMA_INFORMATION_NAMESPACE, 'InfoKindVersion');

  // Headline の検証
  const headlineChild = exactlyOneChild(
    head,
    JMA_INFORMATION_NAMESPACE,
    'Headline',
    'Head/Headline',
  );
  if ('error' in headlineChild) {
    return { ok: false, disposition: '未対応構造', reason: headlineChild.error };
  }
  const headline = headlineChild.element;

  // 判定#7: Headline/Text 検証（取消のみ null 許容）
  const headlineTextNode = directText(headline, JMA_INFORMATION_NAMESPACE, 'Text');
  let headlineText: string | null = headlineTextNode;
  if (isCancelled) {
    if (!headlineText || headlineText.trim().length === 0) {
      headlineText = null;
    }
  } else {
    if (!headlineText || headlineText.trim().length === 0) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: 'Headline/Text が存在しないか空文字列です',
      };
    }
  }

  // Headline/Information の検証
  const allInfoElements = directChildren(headline, JMA_INFORMATION_NAMESPACE, 'Information');

  // 判定#10: 既知5種以外の Information@type が存在するか検証
  const infoTypeMap = new Map<string, Element[]>();
  for (const infoElem of allInfoElements) {
    const typeAttr = infoElem.getAttribute('type')?.trim();
    if (!typeAttr || !KNOWN_INFORMATION_TYPES.has(typeAttr)) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `未知または空の Information@type です: ${typeAttr ?? '(空)'}`,
      };
    }
    const list = infoTypeMap.get(typeAttr) ?? [];
    list.push(infoElem);
    infoTypeMap.set(typeAttr, list);
  }

  // 必須4種（発表細分・一次細分区域等・市町村等をまとめた地域等・市町村等）の存在検証
  // 発表細分（判定#8）
  const saibunList = infoTypeMap.get('竜巻注意情報（発表細分）') ?? [];
  let saibunInfoElem: Element | null = null;
  if (isCancelled) {
    if (saibunList.length > 1) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `Information[@type="竜巻注意情報（発表細分）"] が複数存在します（${saibunList.length}件）`,
      };
    }
    if (saibunList.length === 1) {
      saibunInfoElem = saibunList[0]!;
    }
  } else {
    if (saibunList.length !== 1) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `Information[@type="竜巻注意情報（発表細分）"] は1件である必要があります（実際: ${saibunList.length}件）`,
      };
    }
    saibunInfoElem = saibunList[0]!;
  }

  // 一次細分区域等・市町村等をまとめた地域等・市町村等 の存在検証（各1件必須）
  const otherRequiredTypes = [
    '竜巻注意情報（一次細分区域等）',
    '竜巻注意情報（市町村等をまとめた地域等）',
    '竜巻注意情報（市町村等）',
  ] as const;

  for (const reqType of otherRequiredTypes) {
    const list = infoTypeMap.get(reqType) ?? [];
    if (list.length !== 1) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `Information[@type="${reqType}"] は1件である必要があります（実際: ${list.length}件）`,
      };
    }
  }

  // 目撃情報あり Information の存在確認
  const sightingList = infoTypeMap.get(VPHW_SIGHTING_INFORMATION_TYPE) ?? [];
  if (sightingList.length > 1) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: `Information[@type="${VPHW_SIGHTING_INFORMATION_TYPE}"] が複数存在します（${sightingList.length}件）`,
    };
  }

  // 判定#9: 発表細分 Information が存在する場合の構造検証
  let saibunAreaCode: string | null = null;
  let informationTag: string | null = null;

  if (saibunInfoElem) {
    const items = directChildren(saibunInfoElem, JMA_INFORMATION_NAMESPACE, 'Item');
    if (items.length !== 1) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `発表細分 Information の Item は1件である必要があります（実際: ${items.length}件）`,
      };
    }
    const item = items[0]!;

    const kindChild = exactlyOneChild(
      item,
      JMA_INFORMATION_NAMESPACE,
      'Kind',
      '発表細分 Information/Item/Kind',
    );
    if ('error' in kindChild) {
      return { ok: false, disposition: '未対応構造', reason: kindChild.error };
    }
    const kind = kindChild.element;

    const kindName = directText(kind, JMA_INFORMATION_NAMESPACE, 'Name');
    if (kindName !== '竜巻注意情報') {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `発表細分 Kind/Name (${kindName}) が '竜巻注意情報' と一致しません`,
      };
    }
    informationTag = kindName;

    const condition = directText(kind, JMA_INFORMATION_NAMESPACE, 'Condition');
    if (condition !== '発表') {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `発表細分 Kind/Condition (${condition}) が '発表' と一致しません`,
      };
    }

    const areasChild = exactlyOneChild(
      item,
      JMA_INFORMATION_NAMESPACE,
      'Areas',
      '発表細分 Information/Item/Areas',
    );
    if ('error' in areasChild) {
      return { ok: false, disposition: '未対応構造', reason: areasChild.error };
    }
    const areasElem = areasChild.element;

    const codeType = areasElem.getAttribute('codeType')?.trim();
    if (!codeType) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: '発表細分 Information/Item/Areas@codeType が存在しません',
      };
    }

    const areaList = directChildren(areasElem, JMA_INFORMATION_NAMESPACE, 'Area');
    if (areaList.length !== 1) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `発表細分 Information/Item/Areas/Area は1件である必要があります（実際: ${areaList.length}件）`,
      };
    }
    const areaElem = areaList[0]!;
    const areaName = directText(areaElem, JMA_INFORMATION_NAMESPACE, 'Name');
    const areaCode = directText(areaElem, JMA_INFORMATION_NAMESPACE, 'Code');
    if (!areaName || !areaCode) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: '発表細分 Area の Name または Code が欠落しています',
      };
    }
    saibunAreaCode = areaCode;
  }

  // 合成キー（eventId）の決定（§3.3）
  let eventId: string;
  if (saibunAreaCode) {
    eventId = `${telegramType}:${saibunAreaCode}`;
  } else {
    eventId = `${telegramType}:cancel:${controlDateTime}`;
  }

  // 目撃情報フラグの判定（§3.4）
  let hasSighting: boolean | null = null;
  if (telegramType === VPHW51_TELEGRAM_TYPE) {
    if (sightingList.length === 1) {
      const sightingElem = sightingList[0]!;
      const items = directChildren(sightingElem, JMA_INFORMATION_NAMESPACE, 'Item');
      const hasIssuedItem = items.some((it) => {
        const kindElems = directChildren(it, JMA_INFORMATION_NAMESPACE, 'Kind');
        return kindElems.some(
          (k) => directText(k, JMA_INFORMATION_NAMESPACE, 'Condition') === '発表',
        );
      });
      hasSighting = hasIssuedItem;
    } else {
      hasSighting = false;
    }
  } else {
    // VPHW50 は常に null（判定不能）
    hasSighting = null;
  }

  // 区域抽出（§3.5: Headline のみから抽出、Body は絶対に走査しない）
  type RawArea = { areaCode: string; areaName: string; codeType: string };
  const rawAreas: RawArea[] = [];

  for (const infoElem of allInfoElements) {
    const items = directChildren(infoElem, JMA_INFORMATION_NAMESPACE, 'Item');
    for (const item of items) {
      const kindElems = directChildren(item, JMA_INFORMATION_NAMESPACE, 'Kind');
      if (kindElems.length === 0) {
        return {
          ok: false,
          disposition: '未対応構造',
          reason: 'Information/Item に Kind 要素がありません',
        };
      }
      const condition = directText(kindElems[0]!, JMA_INFORMATION_NAMESPACE, 'Condition');
      // Condition が '発表' の Item のみを採用
      if (condition !== '発表') {
        continue;
      }

      const areasElements = directChildren(item, JMA_INFORMATION_NAMESPACE, 'Areas');
      for (const areasElem of areasElements) {
        const codeType = areasElem.getAttribute('codeType')?.trim();
        if (!codeType) {
          return {
            ok: false,
            disposition: '未対応構造',
            reason: 'Information/Item/Areas@codeType が存在しません',
          };
        }
        const areaNodes = directChildren(areasElem, JMA_INFORMATION_NAMESPACE, 'Area');
        for (const areaElem of areaNodes) {
          const name = directText(areaElem, JMA_INFORMATION_NAMESPACE, 'Name');
          const code = directText(areaElem, JMA_INFORMATION_NAMESPACE, 'Code');
          if (!name || !code) {
            return {
              ok: false,
              disposition: '未対応構造',
              reason: 'Information/Item/Areas/Area の Name または Code が欠落しています',
            };
          }
          rawAreas.push({ areaCode: code, areaName: name, codeType });
        }
      }
    }
  }

  // 重複除去（(areaCode, codeType) の組で重複除去、sequence は 0 起点連番）
  const seenAreaKeys = new Set<string>();
  const areas: BosaiBulletinAreaInput[] = [];

  for (const raw of rawAreas) {
    const key = `${raw.areaCode}:${raw.codeType}`;
    if (!seenAreaKeys.has(key)) {
      seenAreaKeys.add(key);
      areas.push({
        areaCode: raw.areaCode,
        areaName: raw.areaName,
        codeType: raw.codeType,
        sequence: areas.length,
      });
    }
  }

  // 判定#12: 抽出区域が0件の場合
  if (areas.length === 0) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: '抽出区域が0件です',
    };
  }

  // 判定#13: 対象地域判定（§3.5）
  const hasIncludedArea = areas.some((a) => target.includedAreaCodes.includes(a.areaCode));
  if (!hasIncludedArea) {
    return {
      ok: false,
      disposition: '対象地域外',
      reason: `対象会場の区域コード（${target.includedAreaCodes.join(', ')}）に一致する区域が含まれていません`,
    };
  }

  return {
    ok: true,
    value: {
      telegramType,
      eventId,
      controlStatus,
      infoType,
      reportDateTime,
      controlDateTime,
      validDateTime,
      title,
      headlineText,
      informationTag,
      hasSighting,
      isCancelled,
      infoKindVersion,
      areas,
    },
  };
}
