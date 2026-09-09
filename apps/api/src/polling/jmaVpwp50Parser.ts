import { DOMParser, type Element } from '@xmldom/xmldom';
import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import {
  VPWP50_TELEGRAM_TYPE,
  type ControlStatus,
  type ParsedVpwp50TimeDefine,
  type ParsedVpwp50Value,
  type TelegramReception,
  type Vpwp50ParseResult,
  type WarningTimeseriesTargetArea,
} from '../repositories/types.js';
import { resolveWarningTimeseriesTargetArea } from '../venueForecastTargets.js';

export const JMA_REPORT_NAMESPACE = 'http://xml.kishou.go.jp/jmaxml1/';
export const JMA_INFORMATION_NAMESPACE = 'http://xml.kishou.go.jp/jmaxml1/informationBasis1/';
export const JMA_METEOROLOGY_NAMESPACE = 'http://xml.kishou.go.jp/jmaxml1/body/meteorology1/';
export const JMA_ELEMENT_BASIS_NAMESPACE = 'http://xml.kishou.go.jp/jmaxml1/elementBasis1/';

export const EXPECTED_METEOROLOGICAL_INFOS_TYPE = '量的予想時系列（市町村等）';
export const EXPECTED_INFO_KIND = '気象警報・注意報時系列';

export const DEFAULT_VPWP50_TARGET_AREA: WarningTimeseriesTargetArea =
  resolveWarningTimeseriesTargetArea('east');

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

export function addIso8601Duration(startDateIso: string, duration: string): string | null {
  const match = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    duration,
  );
  if (!match) return null;
  const [, y, m, d, h, min, s] = match;
  if (!y && !m && !d && !h && !min && !s) return null;

  const date = new Date(startDateIso);
  if (Number.isNaN(date.getTime())) return null;

  if (y) date.setUTCFullYear(date.getUTCFullYear() + Number(y));
  if (m) date.setUTCMonth(date.getUTCMonth() + Number(m));
  if (d) date.setUTCDate(date.getUTCDate() + Number(d));
  if (h) date.setUTCHours(date.getUTCHours() + Number(h));
  if (min) date.setUTCMinutes(date.getUTCMinutes() + Number(min));
  if (s) date.setUTCSeconds(date.getUTCSeconds() + Number(s));

  return date.toISOString();
}

export function parseVpwp50(
  rawXml: string,
  expected: Pick<
    TelegramReception,
    'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
  >,
  targetArea: WarningTimeseriesTargetArea = DEFAULT_VPWP50_TARGET_AREA,
): Vpwp50ParseResult {
  if (expected.telegramType !== VPWP50_TELEGRAM_TYPE) {
    return {
      ok: false,
      disposition: '対象外',
      reason: `VPWP50 以外の電文種別です: ${expected.telegramType}`,
    };
  }

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
  if (infoKind !== EXPECTED_INFO_KIND) {
    return {
      ok: false,
      disposition: '対象外',
      reason: `Head/InfoKind が対象外です: ${infoKind ?? 'null'}`,
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
  if (timeSeriesInfoList.length === 0) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: 'TimeSeriesInfo が1件も存在しません',
    };
  }

  const parsedTimeDefines: ParsedVpwp50TimeDefine[] = [];
  const parsedValues: ParsedVpwp50Value[] = [];
  let foundTargetAreaName: string | null = null;
  let targetAreaFoundInAnyBlock = false;
  let globalSequence = 1;

  for (let blockIndex = 0; blockIndex < timeSeriesInfoList.length; blockIndex += 1) {
    const timeSeriesInfo = timeSeriesInfoList[blockIndex]!;
    const blockId = `timeseries-${blockIndex + 1}`;

    // TimeDefines の検証
    const timeDefinesChild = exactlyOneChild(
      timeSeriesInfo,
      JMA_METEOROLOGY_NAMESPACE,
      'TimeDefines',
      `TimeSeriesInfo[${blockIndex + 1}]/TimeDefines`,
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
        reason: `TimeSeriesInfo[${blockIndex + 1}] の TimeDefine が0件です`,
      };
    }

    const blockTimeIdSet = new Set<string>();
    for (let tdIdx = 0; tdIdx < timeDefineList.length; tdIdx += 1) {
      const tdElem = timeDefineList[tdIdx]!;
      const timeId = tdElem.getAttribute('timeId');
      if (!timeId) {
        return {
          ok: false,
          disposition: '未対応構造',
          reason: `TimeDefine に timeId 属性がありません（block: ${blockId}, index: ${tdIdx}）`,
        };
      }
      if (blockTimeIdSet.has(timeId)) {
        return {
          ok: false,
          disposition: '未対応構造',
          reason: `同一ブロック内で timeId "${timeId}" が重複しています（block: ${blockId}）`,
        };
      }
      blockTimeIdSet.add(timeId);

      const rawDateTime = directText(tdElem, JMA_METEOROLOGY_NAMESPACE, 'DateTime');
      const timeFrom = parseDateTime(rawDateTime);
      if (!timeFrom) {
        return {
          ok: false,
          disposition: '未対応構造',
          reason: `TimeDefine/DateTime が不正です: ${rawDateTime ?? 'null'}（block: ${blockId}）`,
        };
      }

      const duration = directText(tdElem, JMA_METEOROLOGY_NAMESPACE, 'Duration');
      if (!duration) {
        return {
          ok: false,
          disposition: '未対応構造',
          reason: `TimeDefine/Duration が存在しません（block: ${blockId}, timeId: ${timeId}）`,
        };
      }

      const timeTo = addIso8601Duration(timeFrom, duration);
      if (!timeTo) {
        return {
          ok: false,
          disposition: '未対応構造',
          reason: `TimeDefine/Duration "${duration}" の解釈または加算に失敗しました（block: ${blockId}）`,
        };
      }

      parsedTimeDefines.push({
        blockId,
        timeId,
        sequence: tdIdx + 1,
        timeFrom,
        timeTo,
        duration,
      });
    }

    // Item (地域) の走査
    const itemList = directChildren(timeSeriesInfo, JMA_METEOROLOGY_NAMESPACE, 'Item');
    const matchingItems: Element[] = [];

    for (const itemElem of itemList) {
      const areaChild = exactlyOneChild(
        itemElem,
        JMA_METEOROLOGY_NAMESPACE,
        'Area',
        `TimeSeriesInfo[${blockIndex + 1}]/Item/Area`,
      );
      if ('error' in areaChild) {
        return { ok: false, disposition: '未対応構造', reason: areaChild.error };
      }
      const areaCode = directText(areaChild.element, JMA_METEOROLOGY_NAMESPACE, 'Code');
      if (areaCode === targetArea.municipalCode) {
        matchingItems.push(itemElem);
        if (!foundTargetAreaName) {
          foundTargetAreaName = directText(areaChild.element, JMA_METEOROLOGY_NAMESPACE, 'Name');
        }
      }
    }

    if (matchingItems.length > 1) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `同一ブロック内に対象地域 Item が複数存在します（block: ${blockId}, code: ${targetArea.municipalCode}）`,
      };
    }

    if (matchingItems.length === 0) {
      // この block には対象地域がない -> この block の values は 0 件として続行
      continue;
    }

    targetAreaFoundInAnyBlock = true;
    const targetItem = matchingItems[0]!;

    // Kind の走査
    const kindList = directChildren(targetItem, JMA_METEOROLOGY_NAMESPACE, 'Kind');
    for (const kindElem of kindList) {
      const kindStatus = directText(kindElem, JMA_METEOROLOGY_NAMESPACE, 'Status');
      if (!kindStatus) {
        return {
          ok: false,
          disposition: '未対応構造',
          reason: `Kind/Status が存在しません（block: ${blockId}）`,
        };
      }

      const rawKindDateTime = directText(kindElem, JMA_METEOROLOGY_NAMESPACE, 'DateTime');
      const kindDateTime = rawKindDateTime ? parseDateTime(rawKindDateTime) : null;
      if (rawKindDateTime && !kindDateTime) {
        return {
          ok: false,
          disposition: '未対応構造',
          reason: `Kind/DateTime が不正です: ${rawKindDateTime}（block: ${blockId}）`,
        };
      }

      // Property の走査
      const propertyList = directChildren(kindElem, JMA_METEOROLOGY_NAMESPACE, 'Property');
      for (const propElem of propertyList) {
        const propertyType = directText(propElem, JMA_METEOROLOGY_NAMESPACE, 'Type');
        if (!propertyType) {
          return {
            ok: false,
            disposition: '未対応構造',
            reason: `Property/Type が存在しません（block: ${blockId}）`,
          };
        }

        // Property 直下の各 Part 要素を走査（SignificancyPart, PrecipitationPart など）
        for (let pIdx = 0; pIdx < propElem.childNodes.length; pIdx += 1) {
          const partNode = propElem.childNodes.item(pIdx);
          if (partNode?.nodeType !== 1) continue;
          const partElem = partNode as Element;
          if (partElem.namespaceURI !== JMA_METEOROLOGY_NAMESPACE) continue;

          // Base 要素を探す（直接 Base の場合も考慮）
          const baseElements =
            partElem.localName === 'Base'
              ? [partElem]
              : directChildren(partElem, JMA_METEOROLOGY_NAMESPACE, 'Base');

          for (const baseElem of baseElements) {
            // Base 内を走査
            for (let bIdx = 0; bIdx < baseElem.childNodes.length; bIdx += 1) {
              const bNode = baseElem.childNodes.item(bIdx);
              if (bNode?.nodeType !== 1) continue;
              const bChild = bNode as Element;

              if (
                bChild.namespaceURI === JMA_METEOROLOGY_NAMESPACE &&
                bChild.localName === 'Local'
              ) {
                // Local がある場合: AreaName を取得
                const areaDivision = directText(bChild, JMA_METEOROLOGY_NAMESPACE, 'AreaName');
                for (let lIdx = 0; lIdx < bChild.childNodes.length; lIdx += 1) {
                  const lNode = bChild.childNodes.item(lIdx);
                  if (lNode?.nodeType !== 1) continue;
                  const valueElem = lNode as Element;
                  if (valueElem.localName === 'AreaName') continue;

                  const parsedVal = extractValueElement(
                    valueElem,
                    blockId,
                    blockTimeIdSet,
                    kindStatus,
                    kindDateTime,
                    propertyType,
                    areaDivision,
                    globalSequence,
                  );
                  if ('error' in parsedVal) {
                    return { ok: false, disposition: '未対応構造', reason: parsedVal.error };
                  }
                  if (parsedVal.value) {
                    parsedValues.push(parsedVal.value);
                    globalSequence += 1;
                  }
                }
              } else {
                // Local がない場合: Base 直下の値要素
                const parsedVal = extractValueElement(
                  bChild,
                  blockId,
                  blockTimeIdSet,
                  kindStatus,
                  kindDateTime,
                  propertyType,
                  null,
                  globalSequence,
                );
                if ('error' in parsedVal) {
                  return { ok: false, disposition: '未対応構造', reason: parsedVal.error };
                }
                if (parsedVal.value) {
                  parsedValues.push(parsedVal.value);
                  globalSequence += 1;
                }
              }
            }
          }
        }
      }
    }
  }

  if (!targetAreaFoundInAnyBlock) {
    return {
      ok: false,
      disposition: '対象地域外',
      reason: `対象地域（コード: ${targetArea.municipalCode}）が全ブロックに存在しません`,
    };
  }

  return {
    ok: true,
    value: {
      area: {
        code: targetArea.municipalCode,
        name: foundTargetAreaName ?? targetArea.displayName,
      },
      controlStatus,
      infoType,
      eventId,
      controlDateTime,
      reportDateTime,
      infoKindVersion,
      timeDefines: parsedTimeDefines,
      values: parsedValues,
    },
  };
}

function extractValueElement(
  elem: Element,
  blockId: string,
  blockTimeIdSet: Set<string>,
  kindStatus: string,
  kindDateTime: UtcIso8601String | null,
  propertyType: string,
  areaDivision: string | null,
  sequence: number,
): { value: ParsedVpwp50Value | null } | { error: string } {
  // 1. Significancy (危険度)
  if (elem.namespaceURI === JMA_METEOROLOGY_NAMESPACE && elem.localName === 'Significancy') {
    const refId = elem.getAttribute('refID');
    if (!refId) {
      return { error: `Significancy に refID 属性がありません（block: ${blockId}）` };
    }
    if (!blockTimeIdSet.has(refId)) {
      return {
        error: `Significancy の refID "${refId}" がブロック内の TimeDefine に存在しません（block: ${blockId}）`,
      };
    }
    const name = directText(elem, JMA_METEOROLOGY_NAMESPACE, 'Name');
    const code = directText(elem, JMA_METEOROLOGY_NAMESPACE, 'Code');
    if (!name || !code) {
      return {
        error: `Significancy に Name または Code が存在しません（block: ${blockId}, refID: ${refId}）`,
      };
    }
    const valueType = elem.getAttribute('type') || propertyType;

    return {
      value: {
        blockId,
        refId,
        kindStatus,
        kindDateTime,
        kindCode: null,
        kindName: null,
        valueCategory: 'risk',
        propertyType,
        valueType,
        valueCode: code,
        valueText: name,
        unit: null,
        description: null,
        condition: null,
        areaDivision,
        sequence,
      },
    };
  }

  // 2. elementBasis 要素（量的値）
  if (elem.namespaceURI === JMA_ELEMENT_BASIS_NAMESPACE) {
    const refId = elem.getAttribute('refID');
    if (!refId) {
      return { error: `${elem.localName} に refID 属性がありません（block: ${blockId}）` };
    }
    if (!blockTimeIdSet.has(refId)) {
      return {
        error: `${elem.localName} の refID "${refId}" がブロック内の TimeDefine に存在しません（block: ${blockId}）`,
      };
    }

    const valueType = elem.getAttribute('type') || elem.localName || elem.nodeName;
    const unit = elem.getAttribute('unit') || null;
    const description = elem.getAttribute('description') || null;
    const condition = elem.getAttribute('condition') || null;

    // テキスト値。condition="値なし" などで空の場合は空文字 ""
    const rawText = elem.textContent?.trim() ?? '';

    return {
      value: {
        blockId,
        refId,
        kindStatus,
        kindDateTime,
        kindCode: null,
        kindName: null,
        valueCategory: 'quantity',
        propertyType,
        valueType,
        valueCode: null,
        valueText: rawText,
        unit,
        description,
        condition,
        areaDivision,
        sequence,
      },
    };
  }

  return { value: null };
}
