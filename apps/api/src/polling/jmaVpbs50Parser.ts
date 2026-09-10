import { DOMParser, type Element } from '@xmldom/xmldom';
import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import {
  BOSAI_BULLETIN_TARGET_TAGS,
  VPBS50_TELEGRAM_TYPE,
  type BosaiBulletinAreaInput,
  type BosaiBulletinTarget,
  type BosaiBulletinTargetTag,
  type ControlStatus,
  type ParsedVpbs50,
  type TelegramReception,
  type Vpbs50ParseResult,
} from '../repositories/types.js';
import {
  DEFAULT_BOSAI_BULLETIN_TARGET,
  resolveBosaiBulletinTarget,
} from '../venueForecastTargets.js';

export {
  DEFAULT_BOSAI_BULLETIN_TARGET,
  resolveBosaiBulletinTarget,
  type ParsedVpbs50,
  type Vpbs50ParseResult,
};

export const JMA_REPORT_NAMESPACE = 'http://xml.kishou.go.jp/jmaxml1/';
export const JMA_INFORMATION_NAMESPACE = 'http://xml.kishou.go.jp/jmaxml1/informationBasis1/';
export const JMA_METEOROLOGY_NAMESPACE = 'http://xml.kishou.go.jp/jmaxml1/body/meteorology1/';

export const EXPECTED_CONTROL_TITLE = '府県気象防災速報';
export const EXPECTED_INFO_KIND = '気象解説情報';
export const EXPECTED_INFO_TAG_NAME = '情報タグ';

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

export function parseVpbs50(
  rawXml: string,
  expected: Pick<
    TelegramReception,
    'telegramType' | 'controlStatus' | 'reportDateTime' | 'controlDateTime'
  >,
  target: BosaiBulletinTarget = DEFAULT_BOSAI_BULLETIN_TARGET,
): Vpbs50ParseResult {
  // 1. 電文種別チェック
  if (expected.telegramType !== VPBS50_TELEGRAM_TYPE) {
    return {
      ok: false,
      disposition: '対象外',
      reason: `VPBS50 以外の電文種別です: ${expected.telegramType}`,
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

  const controlTitle = directText(control, JMA_REPORT_NAMESPACE, 'Title');
  if (controlTitle !== EXPECTED_CONTROL_TITLE) {
    return {
      ok: false,
      disposition: '対象外',
      reason: `Control/Title (${controlTitle}) が想定 (${EXPECTED_CONTROL_TITLE}) と一致しません`,
    };
  }

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

  const title = directText(head, JMA_INFORMATION_NAMESPACE, 'Title');
  if (!title) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: 'Head/Title が見つかりません',
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

  const targetDateTimeText = directText(head, JMA_INFORMATION_NAMESPACE, 'TargetDateTime');
  let targetDateTime: UtcIso8601String | null = null;
  if (targetDateTimeText) {
    targetDateTime = parseDateTime(targetDateTimeText);
    if (!targetDateTime) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `Head/TargetDateTime (${targetDateTimeText}) が不正です`,
      };
    }
  }

  const eventId = directText(head, JMA_INFORMATION_NAMESPACE, 'EventID');
  if (!eventId) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: 'Head/EventID が見つかりません',
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

  const infoKindVersion = directText(head, JMA_INFORMATION_NAMESPACE, 'InfoKindVersion');
  const isCancelled = infoType === '取消';

  // 5. Headline の検証
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

  // 6. 情報タグ（Headline/Information[@type="情報タグ"]）の検証
  const allInfoElements = directChildren(headline, JMA_INFORMATION_NAMESPACE, 'Information');
  const tagInfoElements = allInfoElements.filter((el) => el.getAttribute('type') === '情報タグ');

  let informationTag: BosaiBulletinTargetTag | null = null;
  let tagItemElement: Element | null = null;

  if (isCancelled) {
    if (tagInfoElements.length > 1) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `Headline/Information[@type="情報タグ"] が複数存在します（${tagInfoElements.length}件）`,
      };
    }
    if (tagInfoElements.length === 1) {
      const items = directChildren(tagInfoElements[0]!, JMA_INFORMATION_NAMESPACE, 'Item');
      if (items.length > 1) {
        return {
          ok: false,
          disposition: '未対応構造',
          reason: `Headline/Information[@type="情報タグ"]/Item が複数存在します（${items.length}件）`,
        };
      }
      if (items.length === 1) {
        tagItemElement = items[0]!;
      }
    }
  } else {
    if (tagInfoElements.length !== 1) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `Headline/Information[@type="情報タグ"] は1件である必要があります（実際: ${tagInfoElements.length}件）`,
      };
    }
    const items = directChildren(tagInfoElements[0]!, JMA_INFORMATION_NAMESPACE, 'Item');
    if (items.length !== 1) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `Headline/Information[@type="情報タグ"]/Item は1件である必要があります（実際: ${items.length}件）`,
      };
    }
    tagItemElement = items[0]!;
  }

  if (tagItemElement) {
    const kindChild = exactlyOneChild(
      tagItemElement,
      JMA_INFORMATION_NAMESPACE,
      'Kind',
      'Information/Item/Kind',
    );
    if ('error' in kindChild) {
      return { ok: false, disposition: '未対応構造', reason: kindChild.error };
    }
    const kindElem = kindChild.element;

    const kindName = directText(kindElem, JMA_INFORMATION_NAMESPACE, 'Name');
    if (kindName !== EXPECTED_INFO_TAG_NAME) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: `Kind/Name (${kindName}) が想定 (${EXPECTED_INFO_TAG_NAME}) と一致しません`,
      };
    }

    const condition = directText(kindElem, JMA_INFORMATION_NAMESPACE, 'Condition');
    if (!condition) {
      return {
        ok: false,
        disposition: '未対応構造',
        reason: 'Kind/Condition が見つかりません',
      };
    }

    if (condition === '短時間大雪') {
      return {
        ok: false,
        disposition: '対象外',
        reason: '短時間大雪は対象外の速報種別です',
      };
    }

    if (!(BOSAI_BULLETIN_TARGET_TAGS as readonly string[]).includes(condition)) {
      return {
        ok: false,
        disposition: '対象外',
        reason: `対象外の情報タグ Condition です: ${condition}`,
      };
    }

    informationTag = condition as BosaiBulletinTargetTag;
  }

  // 7. 区域の抽出（Headline + Body）
  type RawArea = { areaCode: string; areaName: string; codeType: string };
  const rawAreas: RawArea[] = [];

  // 7.1 Headline からの抽出
  if (tagItemElement) {
    const areasElements = directChildren(tagItemElement, JMA_INFORMATION_NAMESPACE, 'Areas');
    for (const areasElem of areasElements) {
      const codeType = areasElem.getAttribute('codeType')?.trim();
      if (!codeType) {
        return {
          ok: false,
          disposition: '未対応構造',
          reason: 'Headline/Information/Item/Areas@codeType が存在しません',
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
            reason: 'Headline/Information/Item/Areas/Area の Name または Code が欠落しています',
          };
        }
        rawAreas.push({ areaCode: code, areaName: name, codeType });
      }
    }
  }

  // 7.2 Body からの抽出
  const bodyList = directChildren(root, JMA_METEOROLOGY_NAMESPACE, 'Body');
  if (bodyList.length > 1) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: `Report/Body が複数存在します（${bodyList.length}件）`,
    };
  }
  if (bodyList.length === 1) {
    const body = bodyList[0]!;
    const meteorologicalInfosList = directChildren(
      body,
      JMA_METEOROLOGY_NAMESPACE,
      'MeteorologicalInfos',
    );
    for (const mInfos of meteorologicalInfosList) {
      const mInfoList = directChildren(mInfos, JMA_METEOROLOGY_NAMESPACE, 'MeteorologicalInfo');
      for (const mInfo of mInfoList) {
        const itemList = directChildren(mInfo, JMA_METEOROLOGY_NAMESPACE, 'Item');
        for (const item of itemList) {
          const areaList = directChildren(item, JMA_METEOROLOGY_NAMESPACE, 'Area');
          for (const areaElem of areaList) {
            const codeType = areaElem.getAttribute('codeType')?.trim();
            if (!codeType) {
              return {
                ok: false,
                disposition: '未対応構造',
                reason: 'Body/.../Area@codeType が存在しません',
              };
            }
            const name = directText(areaElem, JMA_METEOROLOGY_NAMESPACE, 'Name');
            const code = directText(areaElem, JMA_METEOROLOGY_NAMESPACE, 'Code');
            if (!name || !code) {
              return {
                ok: false,
                disposition: '未対応構造',
                reason: 'Body/.../Area の Name または Code が欠落しています',
              };
            }
            rawAreas.push({ areaCode: code, areaName: name, codeType });
          }
        }
      }
    }
  }

  // 7.3 重複除去（(areaCode, codeType) の組で重複除去、0 起点連番）
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

  // 7.4 取消電文の特別検証（§3.6）
  if (isCancelled && informationTag === null && areas.length === 0) {
    return {
      ok: false,
      disposition: '未対応構造',
      reason: '取消電文で情報タグがなく、かつ抽出区域が0件です',
    };
  }

  // 7.5 対象地域判定（§3.4）
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
      eventId,
      controlStatus,
      infoType,
      reportDateTime,
      targetDateTime,
      controlDateTime,
      title,
      headlineText,
      informationTag,
      isCancelled,
      infoKindVersion,
      areas,
    },
  };
}
