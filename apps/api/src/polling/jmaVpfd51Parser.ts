import { DOMParser, type Element } from '@xmldom/xmldom';
import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import {
  VPFD51_TELEGRAM_TYPE,
  type AreaTimeseriesForecastTarget,
  type AreaTimeseriesTimeDefineInput,
  type AreaTimeseriesValueInput,
  type ControlStatus,
  type ParsedVpfd51,
  type TelegramReception,
  type Vpfd51ParseResult,
} from '../repositories/types.js';
import { addIso8601Duration } from './jmaVpwp50Parser.js';
import { resolveAreaTimeseriesForecastTarget } from '../venueForecastTargets.js';

export const JMA_REPORT_NAMESPACE = 'http://xml.kishou.go.jp/jmaxml1/';
export const JMA_INFORMATION_NAMESPACE = 'http://xml.kishou.go.jp/jmaxml1/informationBasis1/';
export const JMA_METEOROLOGY_NAMESPACE = 'http://xml.kishou.go.jp/jmaxml1/body/meteorology1/';
export const JMA_ELEMENT_BASIS_NAMESPACE = 'http://xml.kishou.go.jp/jmaxml1/elementBasis1/';

export const EXPECTED_INFO_KIND = '府県天気予報';
export const EXPECTED_METEOROLOGICAL_INFOS_TYPE_REGION = '区域予報';
export const EXPECTED_METEOROLOGICAL_INFOS_TYPE_POINT = '地点予報';

export const PROPERTY_TYPE_WEATHER = '３時間内卓越天気';
export const PROPERTY_TYPE_WIND = '３時間内代表風';
export const PROPERTY_TYPE_TEMPERATURE = '３時間毎気温';

export const BLOCK_ID_REGION = 'region-3hour';
export const BLOCK_ID_TEMPERATURE = 'temperature-3hour';

export const DEFAULT_AREA_TIMESERIES_FORECAST_TARGET: AreaTimeseriesForecastTarget =
  resolveAreaTimeseriesForecastTarget('east');

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

export function parseVpfd51(
  rawXml: string,
  expected: Pick<
    TelegramReception,
    'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
  >,
  target: AreaTimeseriesForecastTarget = DEFAULT_AREA_TIMESERIES_FORECAST_TARGET,
): Vpfd51ParseResult {
  // 1. 電文種別チェック
  if (expected.telegramType !== VPFD51_TELEGRAM_TYPE) {
    return {
      ok: false,
      disposition: '対象外',
      reason: `VPFD51 以外の電文種別です: ${expected.telegramType}`,
    };
  }

  // 2. XML ドキュメントパース
  const root = parseDocument(rawXml);
  if (!root || root.namespaceURI !== JMA_REPORT_NAMESPACE || root.localName !== 'Report') {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: 'Report ルート要素が不正です',
    };
  }

  // 3. Control の検証
  const controlChild = exactlyOneChild(root, JMA_REPORT_NAMESPACE, 'Control', 'Report/Control');
  if ('error' in controlChild) {
    return { ok: false, disposition: '未対応構造', reason: controlChild.error };
  }
  const control = controlChild.element;

  const statusText = directText(control, JMA_REPORT_NAMESPACE, 'Status');
  const controlStatus = parseControlStatus(statusText);
  if (!controlStatus || controlStatus !== expected.controlStatus) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: `Control/Status (${statusText}) が expected (${expected.controlStatus}) と一致しません`,
    };
  }

  const dateTimeText = directText(control, JMA_REPORT_NAMESPACE, 'DateTime');
  const controlDateTime = parseDateTime(dateTimeText);
  if (!controlDateTime || controlDateTime !== expected.controlDateTime) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: `Control/DateTime (${dateTimeText} -> ${controlDateTime}) が expected (${expected.controlDateTime}) と一致しません`,
    };
  }

  // 4. Head の検証
  const headChild = exactlyOneChild(root, JMA_INFORMATION_NAMESPACE, 'Head', 'Report/Head');
  if ('error' in headChild) {
    return { ok: false, disposition: '未対応構造', reason: headChild.error };
  }
  const head = headChild.element;

  const infoKind = directText(head, JMA_INFORMATION_NAMESPACE, 'InfoKind');
  if (infoKind !== EXPECTED_INFO_KIND) {
    return {
      ok: false,
      disposition: '対象外',
      reason: `Head/InfoKind (${infoKind}) が想定 (${EXPECTED_INFO_KIND}) と一致しません`,
    };
  }

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

  const eventId = directText(head, JMA_INFORMATION_NAMESPACE, 'EventID');
  const infoKindVersion = directText(head, JMA_INFORMATION_NAMESPACE, 'InfoKindVersion');

  // 5. Body の検証
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

  const regionInfos = meteorologicalInfosList.filter(
    (info) => info.getAttribute('type') === EXPECTED_METEOROLOGICAL_INFOS_TYPE_REGION,
  );
  if (regionInfos.length === 0) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: `MeteorologicalInfos[type="${EXPECTED_METEOROLOGICAL_INFOS_TYPE_REGION}"] が存在しません`,
    };
  }

  const pointInfos = meteorologicalInfosList.filter(
    (info) => info.getAttribute('type') === EXPECTED_METEOROLOGICAL_INFOS_TYPE_POINT,
  );
  if (pointInfos.length === 0) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: `MeteorologicalInfos[type="${EXPECTED_METEOROLOGICAL_INFOS_TYPE_POINT}"] が存在しません`,
    };
  }

  // 6. 区域ブロックの探索
  // 日単位の区域予報（対象 Property/Type を持たない）は無視し、
  // 対象 AreaCode かつ ３時間内卓越天気・３時間内代表風 をともに持つ TimeSeriesInfo を抽出
  type MatchingRegionItem = {
    readonly timeSeriesInfo: Element;
    readonly item: Element;
    readonly areaName: string;
    readonly weatherProperty: Element;
    readonly windProperty: Element;
  };

  const matchingRegionItems: MatchingRegionItem[] = [];
  let foundTargetAreaCodeInRegion = false;
  let targetRegionInfosCount = 0;

  for (const rInfo of regionInfos) {
    const tsInfos = directChildren(rInfo, JMA_METEOROLOGY_NAMESPACE, 'TimeSeriesInfo');
    let hasTargetPropertyInThisInfo = false;

    for (const tsInfo of tsInfos) {
      const items = directChildren(tsInfo, JMA_METEOROLOGY_NAMESPACE, 'Item');
      for (const item of items) {
        const areaChild = exactlyOneChild(item, JMA_METEOROLOGY_NAMESPACE, 'Area', 'Item/Area');
        if ('error' in areaChild) continue;
        const areaCode = directText(areaChild.element, JMA_METEOROLOGY_NAMESPACE, 'Code');
        const areaName = directText(areaChild.element, JMA_METEOROLOGY_NAMESPACE, 'Name');

        if (areaCode === target.forecastAreaCode) {
          foundTargetAreaCodeInRegion = true;
          const kinds = directChildren(item, JMA_METEOROLOGY_NAMESPACE, 'Kind');
          let weatherProperty: Element | null = null;
          let windProperty: Element | null = null;

          for (const kind of kinds) {
            const properties = directChildren(kind, JMA_METEOROLOGY_NAMESPACE, 'Property');
            for (const prop of properties) {
              const propType = directText(prop, JMA_METEOROLOGY_NAMESPACE, 'Type');
              if (propType === PROPERTY_TYPE_WEATHER) {
                if (weatherProperty) {
                  return {
                    ok: false,
                    disposition: '未対応構造',
                    reason: `同一 Item 内に ${PROPERTY_TYPE_WEATHER} が重複しています`,
                  };
                }
                weatherProperty = prop;
              } else if (propType === PROPERTY_TYPE_WIND) {
                if (windProperty) {
                  return {
                    ok: false,
                    disposition: '未対応構造',
                    reason: `同一 Item 内に ${PROPERTY_TYPE_WIND} が重複しています`,
                  };
                }
                windProperty = prop;
              }
            }
          }

          if (weatherProperty || windProperty) {
            hasTargetPropertyInThisInfo = true;
          }

          if (weatherProperty && windProperty && areaName) {
            matchingRegionItems.push({
              timeSeriesInfo: tsInfo,
              item,
              areaName,
              weatherProperty,
              windProperty,
            });
          }
        }
      }
    }

    if (hasTargetPropertyInThisInfo) {
      targetRegionInfosCount += 1;
    }
  }

  if (targetRegionInfosCount > 1) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: `対象の区域予報 MeteorologicalInfos が複数存在します（${targetRegionInfosCount}件）`,
    };
  }

  if (matchingRegionItems.length === 0) {
    if (!foundTargetAreaCodeInRegion) {
      return {
        ok: false,
        disposition: '対象地域外',
        reason: `対象広域予報区域（${target.forecastAreaCode}）が見つかりません`,
      };
    }
    return {
      ok: false,
      disposition: '未対応構造',
      reason: `対象広域予報区域（${target.forecastAreaCode}）の ${PROPERTY_TYPE_WEATHER} または ${PROPERTY_TYPE_WIND} が見つかりません`,
    };
  }

  if (matchingRegionItems.length > 1) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: `対象広域予報区域（${target.forecastAreaCode}）の候補が複数存在します（${matchingRegionItems.length}件）`,
    };
  }

  const regionMatch = matchingRegionItems[0]!;

  // 7. 地点ブロックの探索
  // 日単位の地点予報（対象 Property/Type を持たない）は無視し、
  // 対象 StationCode かつ ３時間毎気温 を持つ TimeSeriesInfo を抽出
  type MatchingPointItem = {
    readonly timeSeriesInfo: Element;
    readonly item: Element;
    readonly stationName: string;
    readonly tempProperty: Element;
  };

  const matchingPointItems: MatchingPointItem[] = [];
  let foundTargetStationCodeInPoint = false;
  let targetPointInfosCount = 0;

  for (const pInfo of pointInfos) {
    const tsInfos = directChildren(pInfo, JMA_METEOROLOGY_NAMESPACE, 'TimeSeriesInfo');
    let hasTargetPropertyInThisInfo = false;

    for (const tsInfo of tsInfos) {
      const items = directChildren(tsInfo, JMA_METEOROLOGY_NAMESPACE, 'Item');
      for (const item of items) {
        const stationChild = exactlyOneChild(
          item,
          JMA_METEOROLOGY_NAMESPACE,
          'Station',
          'Item/Station',
        );
        if ('error' in stationChild) continue;
        const stationCode = directText(stationChild.element, JMA_METEOROLOGY_NAMESPACE, 'Code');
        const stationName = directText(stationChild.element, JMA_METEOROLOGY_NAMESPACE, 'Name');

        if (stationCode === target.temperatureStationCode) {
          foundTargetStationCodeInPoint = true;
          const kinds = directChildren(item, JMA_METEOROLOGY_NAMESPACE, 'Kind');
          let tempProperty: Element | null = null;

          for (const kind of kinds) {
            const properties = directChildren(kind, JMA_METEOROLOGY_NAMESPACE, 'Property');
            for (const prop of properties) {
              const propType = directText(prop, JMA_METEOROLOGY_NAMESPACE, 'Type');
              if (propType === PROPERTY_TYPE_TEMPERATURE) {
                if (tempProperty) {
                  return {
                    ok: false,
                    disposition: '未対応構造',
                    reason: `同一 Item 内に ${PROPERTY_TYPE_TEMPERATURE} が重複しています`,
                  };
                }
                tempProperty = prop;
              }
            }
          }

          if (tempProperty) {
            hasTargetPropertyInThisInfo = true;
          }

          if (tempProperty && stationName) {
            matchingPointItems.push({
              timeSeriesInfo: tsInfo,
              item,
              stationName,
              tempProperty,
            });
          }
        }
      }
    }

    if (hasTargetPropertyInThisInfo) {
      targetPointInfosCount += 1;
    }
  }

  if (targetPointInfosCount > 1) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: `対象の地点予報 MeteorologicalInfos が複数存在します（${targetPointInfosCount}件）`,
    };
  }

  if (matchingPointItems.length === 0) {
    if (!foundTargetStationCodeInPoint) {
      return {
        ok: false,
        disposition: '対象地域外',
        reason: `対象気温予報地点（${target.temperatureStationCode}）が見つかりません`,
      };
    }
    return {
      ok: false,
      disposition: '未対応構造',
      reason: `対象気温予報地点（${target.temperatureStationCode}）の ${PROPERTY_TYPE_TEMPERATURE} が見つかりません`,
    };
  }

  if (matchingPointItems.length > 1) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: `対象気温予報地点（${target.temperatureStationCode}）の候補が複数存在します（${matchingPointItems.length}件）`,
    };
  }

  const pointMatch = matchingPointItems[0]!;

  // 8. TimeDefines の抽出
  const timeDefines: AreaTimeseriesTimeDefineInput[] = [];

  // 8.1 区域ブロックの TimeDefines
  const regionTimeDefinesChild = exactlyOneChild(
    regionMatch.timeSeriesInfo,
    JMA_METEOROLOGY_NAMESPACE,
    'TimeDefines',
    'TimeSeriesInfo/TimeDefines(区域)',
  );
  if ('error' in regionTimeDefinesChild) {
    return { ok: false, disposition: '未対応構造', reason: regionTimeDefinesChild.error };
  }
  const regionTimeDefineElems = directChildren(
    regionTimeDefinesChild.element,
    JMA_METEOROLOGY_NAMESPACE,
    'TimeDefine',
  );
  if (regionTimeDefineElems.length === 0) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: '区域の TimeDefine が 0 件です',
    };
  }

  const regionTimeIds = new Set<string>();
  for (let index = 0; index < regionTimeDefineElems.length; index += 1) {
    const tdElem = regionTimeDefineElems[index]!;
    const timeId = tdElem.getAttribute('timeId')?.trim();
    if (!timeId || regionTimeIds.has(timeId)) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `区域の TimeDefine@timeId が不正または重複しています: "${timeId}"`,
      };
    }
    regionTimeIds.add(timeId);

    const dtStr = directText(tdElem, JMA_METEOROLOGY_NAMESPACE, 'DateTime');
    const timeFrom = parseDateTime(dtStr);
    if (!timeFrom) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `区域の TimeDefine/DateTime が不正です: "${dtStr}"`,
      };
    }

    const duration = directText(tdElem, JMA_METEOROLOGY_NAMESPACE, 'Duration');
    if (!duration) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `区域の TimeDefine/Duration が欠落しています（timeId: "${timeId}"）`,
      };
    }

    const timeTo = addIso8601Duration(timeFrom, duration);
    if (!timeTo) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `区域の TimeDefine/Duration の解釈または加算に失敗しました: "${duration}"`,
      };
    }

    timeDefines.push({
      blockId: BLOCK_ID_REGION,
      timeId,
      sequence: index + 1,
      timeFrom,
      timeTo,
      duration,
    });
  }

  // 8.2 地点ブロックの TimeDefines
  const pointTimeDefinesChild = exactlyOneChild(
    pointMatch.timeSeriesInfo,
    JMA_METEOROLOGY_NAMESPACE,
    'TimeDefines',
    'TimeSeriesInfo/TimeDefines(地点)',
  );
  if ('error' in pointTimeDefinesChild) {
    return { ok: false, disposition: '未対応構造', reason: pointTimeDefinesChild.error };
  }
  const pointTimeDefineElems = directChildren(
    pointTimeDefinesChild.element,
    JMA_METEOROLOGY_NAMESPACE,
    'TimeDefine',
  );
  if (pointTimeDefineElems.length === 0) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: '地点の TimeDefine が 0 件です',
    };
  }

  const pointTimeIds = new Set<string>();
  for (let index = 0; index < pointTimeDefineElems.length; index += 1) {
    const tdElem = pointTimeDefineElems[index]!;
    const timeId = tdElem.getAttribute('timeId')?.trim();
    if (!timeId || pointTimeIds.has(timeId)) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `地点の TimeDefine@timeId が不正または重複しています: "${timeId}"`,
      };
    }
    pointTimeIds.add(timeId);

    const dtStr = directText(tdElem, JMA_METEOROLOGY_NAMESPACE, 'DateTime');
    const timeFrom = parseDateTime(dtStr);
    if (!timeFrom) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `地点の TimeDefine/DateTime が不正です: "${dtStr}"`,
      };
    }

    timeDefines.push({
      blockId: BLOCK_ID_TEMPERATURE,
      timeId,
      sequence: index + 1,
      timeFrom,
      timeTo: timeFrom,
      duration: null,
    });
  }

  // 9. Values の抽出
  const values: AreaTimeseriesValueInput[] = [];
  const valueKeys = new Set<string>();
  let valSequence = 0;

  // 9.1 天気 Property
  const weatherPartChild = exactlyOneChild(
    regionMatch.weatherProperty,
    JMA_METEOROLOGY_NAMESPACE,
    'WeatherPart',
    'Property/WeatherPart',
  );
  if ('error' in weatherPartChild) {
    return { ok: false, disposition: '未対応構造', reason: weatherPartChild.error };
  }
  const weatherElems = directChildren(
    weatherPartChild.element,
    JMA_ELEMENT_BASIS_NAMESPACE,
    'Weather',
  );
  if (weatherElems.length === 0) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: 'Weather 要素が 0 件です',
    };
  }

  for (const wElem of weatherElems) {
    const refId = wElem.getAttribute('refID')?.trim();
    if (!refId || !regionTimeIds.has(refId)) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `Weather@refID ("${refId}") が同一ブロックの TimeDefine に解決できません`,
      };
    }
    const text = wElem.textContent?.trim();
    if (!text) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `Weather 要素のテキストが空です（refID: "${refId}"）`,
      };
    }
    const key = `${BLOCK_ID_REGION}:${refId}:weather`;
    if (valueKeys.has(key)) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `同一 (blockId, refId, element) の重複です: ${key}`,
      };
    }
    valueKeys.add(key);

    valSequence += 1;
    values.push({
      blockId: BLOCK_ID_REGION,
      refId,
      element: 'weather',
      valueCode: null,
      valueText: text,
      valueNumber: null,
      unit: null,
      sequence: valSequence,
    });
  }

  // 9.2 代表風 Property
  const windDirPartChild = exactlyOneChild(
    regionMatch.windProperty,
    JMA_METEOROLOGY_NAMESPACE,
    'WindDirectionPart',
    'Property/WindDirectionPart',
  );
  if ('error' in windDirPartChild) {
    return { ok: false, disposition: '未対応構造', reason: windDirPartChild.error };
  }
  const windSpeedPartChild = exactlyOneChild(
    regionMatch.windProperty,
    JMA_METEOROLOGY_NAMESPACE,
    'WindSpeedPart',
    'Property/WindSpeedPart',
  );
  if ('error' in windSpeedPartChild) {
    return { ok: false, disposition: '未対応構造', reason: windSpeedPartChild.error };
  }

  const windDirElems = directChildren(
    windDirPartChild.element,
    JMA_ELEMENT_BASIS_NAMESPACE,
    'WindDirection',
  );
  if (windDirElems.length === 0) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: 'WindDirection 要素が 0 件です',
    };
  }

  for (const wdElem of windDirElems) {
    const refId = wdElem.getAttribute('refID')?.trim();
    if (!refId || !regionTimeIds.has(refId)) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `WindDirection@refID ("${refId}") が同一ブロックの TimeDefine に解決できません`,
      };
    }
    const text = wdElem.textContent?.trim();
    if (!text) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `WindDirection 要素のテキストが空です（refID: "${refId}"）`,
      };
    }
    const unit = wdElem.getAttribute('unit')?.trim() || null;
    const key = `${BLOCK_ID_REGION}:${refId}:wind_direction`;
    if (valueKeys.has(key)) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `同一 (blockId, refId, element) の重複です: ${key}`,
      };
    }
    valueKeys.add(key);

    valSequence += 1;
    values.push({
      blockId: BLOCK_ID_REGION,
      refId,
      element: 'wind_direction',
      valueCode: null,
      valueText: text,
      valueNumber: null,
      unit,
      sequence: valSequence,
    });
  }

  const windSpeedElems = directChildren(
    windSpeedPartChild.element,
    JMA_METEOROLOGY_NAMESPACE,
    'WindSpeedLevel',
  );
  if (windSpeedElems.length === 0) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: 'WindSpeedLevel 要素が 0 件です',
    };
  }

  for (const wsElem of windSpeedElems) {
    const refId = wsElem.getAttribute('refID')?.trim();
    if (!refId || !regionTimeIds.has(refId)) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `WindSpeedLevel@refID ("${refId}") が同一ブロックの TimeDefine に解決できません`,
      };
    }
    const text = wsElem.textContent?.trim();
    if (!text || !['1', '2', '3', '4', '5', '6'].includes(text)) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `WindSpeedLevel の風速階級が不正です（refID: "${refId}", 値: "${text}"）`,
      };
    }
    const key = `${BLOCK_ID_REGION}:${refId}:wind_speed_rank`;
    if (valueKeys.has(key)) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `同一 (blockId, refId, element) の重複です: ${key}`,
      };
    }
    valueKeys.add(key);

    valSequence += 1;
    values.push({
      blockId: BLOCK_ID_REGION,
      refId,
      element: 'wind_speed_rank',
      valueCode: text,
      valueText: null,
      valueNumber: null,
      unit: null,
      sequence: valSequence,
    });
  }

  // 9.3 気温 Property
  const tempPartChild = exactlyOneChild(
    pointMatch.tempProperty,
    JMA_METEOROLOGY_NAMESPACE,
    'TemperaturePart',
    'Property/TemperaturePart',
  );
  if ('error' in tempPartChild) {
    return { ok: false, disposition: '未対応構造', reason: tempPartChild.error };
  }
  const tempElems = directChildren(
    tempPartChild.element,
    JMA_ELEMENT_BASIS_NAMESPACE,
    'Temperature',
  );
  if (tempElems.length === 0) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: 'Temperature 要素が 0 件です',
    };
  }

  for (const tElem of tempElems) {
    const refId = tElem.getAttribute('refID')?.trim();
    if (!refId || !pointTimeIds.has(refId)) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `Temperature@refID ("${refId}") が同一ブロックの TimeDefine に解決できません`,
      };
    }
    const text = tElem.textContent?.trim();
    if (!text) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `Temperature 要素のテキストが空です（refID: "${refId}"）`,
      };
    }

    if (!/^[-+]?\d+(?:\.\d+)?$/.test(text)) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `Temperature の数値形式が不正です（refID: "${refId}", 値: "${text}"）`,
      };
    }
    const num = Number(text);
    if (!Number.isFinite(num)) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `Temperature が有限数値ではありません（refID: "${refId}", 値: "${text}"）`,
      };
    }

    const unit = tElem.getAttribute('unit')?.trim() || null;
    const key = `${BLOCK_ID_TEMPERATURE}:${refId}:temperature`;
    if (valueKeys.has(key)) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `同一 (blockId, refId, element) の重複です: ${key}`,
      };
    }
    valueKeys.add(key);

    valSequence += 1;
    values.push({
      blockId: BLOCK_ID_TEMPERATURE,
      refId,
      element: 'temperature',
      valueCode: null,
      valueText: text,
      valueNumber: num,
      unit,
      sequence: valSequence,
    });
  }

  // 10. 正常結果の構築
  const parsedValue: ParsedVpfd51 = {
    area: {
      code: target.forecastAreaCode,
      name: regionMatch.areaName,
    },
    station: {
      code: target.temperatureStationCode,
      name: pointMatch.stationName,
    },
    controlStatus,
    infoType,
    eventId: eventId || null,
    controlDateTime,
    reportDateTime,
    infoKindVersion: infoKindVersion || null,
    timeDefines,
    values,
  };

  return {
    ok: true,
    value: parsedValue,
  };
}
