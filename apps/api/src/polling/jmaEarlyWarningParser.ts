import { DOMParser, type Element } from '@xmldom/xmldom';
import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import {
  VPFD61_TELEGRAM_TYPE,
  VPFW60_TELEGRAM_TYPE,
  type ControlStatus,
  type EarlyWarningCellInput,
  type EarlyWarningParseResult,
  type EarlyWarningTargetArea,
  type EarlyWarningTimeDefineInput,
  type TelegramReception,
} from '../repositories/types.js';
import { addIso8601Duration } from './jmaVpwp50Parser.js';

export const JMA_REPORT_NAMESPACE = 'http://xml.kishou.go.jp/jmaxml1/';
export const JMA_INFORMATION_NAMESPACE = 'http://xml.kishou.go.jp/jmaxml1/informationBasis1/';
export const JMA_METEOROLOGY_NAMESPACE = 'http://xml.kishou.go.jp/jmaxml1/body/meteorology1/';
export const JMA_ELEMENT_BASIS_NAMESPACE = 'http://xml.kishou.go.jp/jmaxml1/elementBasis1/';

export const EXPECTED_METEOROLOGICAL_INFOS_TYPE = '区域予報';
export const EXPECTED_VPFD61_INFO_KIND = '警報級の可能性（明日まで）';
export const EXPECTED_VPFW60_INFO_KIND = '警報級の可能性（明後日以降）';

export const DEFAULT_EARLY_WARNING_TARGET_AREA: EarlyWarningTargetArea = {
  forecastAreaCode: '130010',
  displayName: '東京地方',
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

export function parseEarlyWarning(
  rawXml: string,
  expected: Pick<
    TelegramReception,
    'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
  >,
  targetArea: EarlyWarningTargetArea = DEFAULT_EARLY_WARNING_TARGET_AREA,
): EarlyWarningParseResult {
  if (
    expected.telegramType !== VPFD61_TELEGRAM_TYPE &&
    expected.telegramType !== VPFW60_TELEGRAM_TYPE
  ) {
    return {
      ok: false,
      disposition: '対象外',
      reason: `VPFD61 / VPFW60 以外の電文種別です: ${expected.telegramType}`,
    };
  }

  const isNear = expected.telegramType === VPFD61_TELEGRAM_TYPE;
  const segment = isNear ? 'near' : 'far';
  const expectedInfoKind = isNear ? EXPECTED_VPFD61_INFO_KIND : EXPECTED_VPFW60_INFO_KIND;

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
  const rawStatus = directText(control, JMA_REPORT_NAMESPACE, 'Status');
  const controlStatus = parseControlStatus(rawStatus);
  if (!controlStatus || controlStatus !== expected.controlStatus) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: `Control/Status が一致しません（XML: ${rawStatus ?? 'null'}, 期待: ${expected.controlStatus}）`,
    };
  }
  const rawControlDateTime = directText(control, JMA_REPORT_NAMESPACE, 'DateTime');
  const controlDateTime = parseDateTime(rawControlDateTime);
  if (!controlDateTime || controlDateTime !== expected.controlDateTime) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: `Control/DateTime が一致しません（XML: ${rawControlDateTime ?? 'null'}, 期待: ${expected.controlDateTime}）`,
    };
  }

  // Head の検証
  const headChild = exactlyOneChild(root, JMA_INFORMATION_NAMESPACE, 'Head', 'Report/Head');
  if ('error' in headChild) {
    return { ok: false, disposition: '未対応構造', reason: headChild.error };
  }
  const head = headChild.element;
  const rawReportDateTime = directText(head, JMA_INFORMATION_NAMESPACE, 'ReportDateTime');
  const reportDateTime = parseDateTime(rawReportDateTime);
  if (!reportDateTime || reportDateTime !== expected.reportDateTime) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: `Head/ReportDateTime が一致しません（XML: ${rawReportDateTime ?? 'null'}, 期待: ${expected.reportDateTime}）`,
    };
  }

  const infoType = directText(head, JMA_INFORMATION_NAMESPACE, 'InfoType');
  if (!infoType) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: 'Head/InfoType が存在しません',
    };
  }

  const infoKind = directText(head, JMA_INFORMATION_NAMESPACE, 'InfoKind');
  if (infoKind !== expectedInfoKind) {
    return {
      ok: false,
      disposition: '対象外',
      reason: `Head/InfoKind が対象外です: ${infoKind ?? 'null'}（期待: ${expectedInfoKind}）`,
    };
  }

  const infoKindVersion = directText(head, JMA_INFORMATION_NAMESPACE, 'InfoKindVersion');
  const eventId = directText(head, JMA_INFORMATION_NAMESPACE, 'EventID');

  // Body / MeteorologicalInfos の検証
  const bodyChild = exactlyOneChild(root, JMA_METEOROLOGY_NAMESPACE, 'Body', 'Report/Body');
  if ('error' in bodyChild) {
    return { ok: false, disposition: '未対応構造', reason: bodyChild.error };
  }
  const body = bodyChild.element;

  const meteorologicalInfosList = directChildren(
    body,
    JMA_METEOROLOGY_NAMESPACE,
    'MeteorologicalInfos',
  );
  const matchingInfos = meteorologicalInfosList.filter(
    (info) => info.getAttribute('type') === EXPECTED_METEOROLOGICAL_INFOS_TYPE,
  );

  if (matchingInfos.length !== 1) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: `MeteorologicalInfos[@type="${EXPECTED_METEOROLOGICAL_INFOS_TYPE}"] は1件である必要があります（実際: ${matchingInfos.length}件）`,
    };
  }

  const targetInfos = matchingInfos[0]!;
  const timeSeriesInfoList = directChildren(
    targetInfos,
    JMA_METEOROLOGY_NAMESPACE,
    'TimeSeriesInfo',
  );
  if (timeSeriesInfoList.length !== 1) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: `TimeSeriesInfo は1件である必要があります（実際: ${timeSeriesInfoList.length}件）`,
    };
  }

  const timeSeriesInfo = timeSeriesInfoList[0]!;

  // TimeDefines の検証
  const timeDefinesChild = exactlyOneChild(
    timeSeriesInfo,
    JMA_METEOROLOGY_NAMESPACE,
    'TimeDefines',
    'TimeSeriesInfo/TimeDefines',
  );
  if ('error' in timeDefinesChild) {
    return { ok: false, disposition: '未対応構造', reason: timeDefinesChild.error };
  }

  const timeDefineList = directChildren(
    timeDefinesChild.element,
    JMA_METEOROLOGY_NAMESPACE,
    'TimeDefine',
  );
  if (timeDefineList.length === 0) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: 'TimeDefine が0件です',
    };
  }

  const parsedTimeDefines: EarlyWarningTimeDefineInput[] = [];
  const timeIdSet = new Set<string>();

  for (let tdIdx = 0; tdIdx < timeDefineList.length; tdIdx += 1) {
    const tdElem = timeDefineList[tdIdx]!;
    const timeId = tdElem.getAttribute('timeId');
    if (!timeId) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `TimeDefine に timeId 属性がありません（index: ${tdIdx}）`,
      };
    }
    if (timeIdSet.has(timeId)) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `timeId "${timeId}" が重複しています`,
      };
    }
    timeIdSet.add(timeId);

    const rawDateTime = directText(tdElem, JMA_METEOROLOGY_NAMESPACE, 'DateTime');
    const timeFrom = parseDateTime(rawDateTime);
    if (!timeFrom) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `TimeDefine/DateTime が不正です: ${rawDateTime ?? 'null'}（timeId: ${timeId}）`,
      };
    }

    const duration = directText(tdElem, JMA_METEOROLOGY_NAMESPACE, 'Duration');
    if (!duration) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `TimeDefine/Duration が存在しません（timeId: ${timeId}）`,
      };
    }

    const timeTo = addIso8601Duration(timeFrom, duration);
    if (!timeTo) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `TimeDefine/Duration の計算に失敗しました: ${duration}（timeId: ${timeId}）`,
      };
    }

    parsedTimeDefines.push({
      timeId,
      sequence: tdIdx + 1,
      timeFrom,
      timeTo,
      duration,
    });
  }

  // Item の走査と対象 Area の特定
  const itemList = directChildren(timeSeriesInfo, JMA_METEOROLOGY_NAMESPACE, 'Item');
  if (itemList.length === 0) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: 'TimeSeriesInfo 内に Item が存在しません',
    };
  }

  const matchingItems: Array<{ itemElem: Element; areaName: string }> = [];

  for (const itemElem of itemList) {
    const areaChild = exactlyOneChild(itemElem, JMA_METEOROLOGY_NAMESPACE, 'Area', 'Item/Area');
    if ('error' in areaChild) {
      return { ok: false, disposition: '未対応構造', reason: areaChild.error };
    }
    const areaCode = directText(areaChild.element, JMA_METEOROLOGY_NAMESPACE, 'Code');
    const areaName = directText(areaChild.element, JMA_METEOROLOGY_NAMESPACE, 'Name');
    if (!areaCode || !areaName) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: 'Item/Area の Code または Name が存在しません',
      };
    }

    if (areaCode === targetArea.forecastAreaCode) {
      matchingItems.push({ itemElem, areaName });
    }
  }

  if (matchingItems.length === 0) {
    return {
      ok: false,
      disposition: '対象地域外',
      reason: `対象地域（${targetArea.displayName} ${targetArea.forecastAreaCode}）が含まれていません`,
    };
  }

  if (matchingItems.length > 1) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: `対象地域（${targetArea.forecastAreaCode}）の Item が複数存在します（${matchingItems.length}件）`,
    };
  }

  const { itemElem: targetItem, areaName: targetAreaName } = matchingItems[0]!;

  // Kind / Property / PossibilityRankOfWarning の解析
  const kindList = directChildren(targetItem, JMA_METEOROLOGY_NAMESPACE, 'Kind');
  if (kindList.length === 0) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: '対象 Item 内に Kind が存在しません',
    };
  }

  const parsedCells: EarlyWarningCellInput[] = [];
  const seenPhenomenonRefId = new Set<string>();

  for (let kindIdx = 0; kindIdx < kindList.length; kindIdx += 1) {
    const kindElem = kindList[kindIdx]!;
    const propertyList = directChildren(kindElem, JMA_METEOROLOGY_NAMESPACE, 'Property');
    if (propertyList.length === 0) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `Kind[${kindIdx + 1}] 内に Property が存在しません`,
      };
    }

    for (let propIdx = 0; propIdx < propertyList.length; propIdx += 1) {
      const propElem = propertyList[propIdx]!;
      const propertyType = directText(propElem, JMA_METEOROLOGY_NAMESPACE, 'Type');
      if (!propertyType) {
        return {
          ok: false,
          disposition: '未対応構造',
          reason: `Kind[${kindIdx + 1}]/Property[${propIdx + 1}] 内に Type が存在しません`,
        };
      }

      const partChild = exactlyOneChild(
        propElem,
        JMA_METEOROLOGY_NAMESPACE,
        'PossibilityRankOfWarningPart',
        `Property[${propIdx + 1}]/PossibilityRankOfWarningPart`,
      );
      if ('error' in partChild) {
        return { ok: false, disposition: '未対応構造', reason: partChild.error };
      }

      const warningList = directChildren(
        partChild.element,
        JMA_ELEMENT_BASIS_NAMESPACE,
        'PossibilityRankOfWarning',
      );
      if (warningList.length === 0) {
        return {
          ok: false,
          disposition: '未対応構造',
          reason: `Property[${propIdx + 1}] 内に PossibilityRankOfWarning が0件です`,
        };
      }

      for (let wIdx = 0; wIdx < warningList.length; wIdx += 1) {
        const warningElem = warningList[wIdx]!;
        const refId = warningElem.getAttribute('refID');
        if (!refId) {
          return {
            ok: false,
            disposition: '未対応構造',
            reason: `PossibilityRankOfWarning に refID がありません（Type: ${propertyType}, index: ${wIdx}）`,
          };
        }

        if (!timeIdSet.has(refId)) {
          return {
            ok: false,
            disposition: '未対応構造',
            reason: `refID "${refId}" の参照先 TimeDefine が存在しません（Type: ${propertyType}）`,
          };
        }

        const phenomenonCode = propertyType;
        const phenomenonName = propertyType;
        const pairKey = `${refId}:${phenomenonCode}`;
        if (seenPhenomenonRefId.has(pairKey)) {
          return {
            ok: false,
            disposition: '未対応構造',
            reason: `同一現象 "${phenomenonCode}" で refID "${refId}" が重複しています`,
          };
        }
        seenPhenomenonRefId.add(pairKey);

        const rawText = warningElem.textContent?.trim();
        const conditionAttr = warningElem.getAttribute('condition')?.trim();
        const rankValue = rawText && rawText.length > 0 ? rawText : null;
        const condition = conditionAttr && conditionAttr.length > 0 ? conditionAttr : null;

        if (rankValue === null && condition === null) {
          return {
            ok: false,
            disposition: '未対応構造',
            reason: `PossibilityRankOfWarning に値も condition 属性もありません（Type: ${propertyType}, refID: ${refId}）`,
          };
        }

        parsedCells.push({
          refId,
          phenomenonCode,
          phenomenonName,
          rankValue,
          condition,
        });
      }
    }
  }

  if (parsedCells.length === 0) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: '解析対象の cell が0件です',
    };
  }

  return {
    ok: true,
    value: {
      segment,
      telegramType: expected.telegramType as 'VPFD61' | 'VPFW60',
      area: {
        code: targetArea.forecastAreaCode,
        name: targetAreaName,
      },
      controlStatus: expected.controlStatus,
      infoType,
      eventId: eventId && eventId.length > 0 ? eventId : null,
      controlDateTime: expected.controlDateTime,
      reportDateTime: expected.reportDateTime,
      infoKindVersion,
      timeDefines: parsedTimeDefines,
      cells: parsedCells,
    },
  };
}
