/**
 * 警報・注意報バッジの純粋関数群 (G3 #54)。
 *
 * コード表・並べ替え・短縮表記・新規/強化/緩和の判定・カード入力組み立てを行う。
 * カード入力の content 組み立てに限り createElement を使う（JSX・hooks は使わない）。
 * 判定ロジックは単一関数 {@link resolveWarningChange} にまとめる（§4.3）。
 */
import { createElement } from 'react';
import type { InfoPanelCardInput } from '../panelDefinitions';
import type { WarningCurrentItem, WarningsResponse } from '@wx-viewer-poc/shared';
import { WarningBadgeList } from './WarningBadgeList';

export type WarningStage = 'special' | 'danger' | 'warning' | 'advisory';

export interface WarningBadgeDefinition {
  readonly code: string;
  readonly stage: WarningStage;
  readonly label: string;
  readonly order: number;
}

const STAGE_ORDER: Readonly<Record<WarningStage, number>> = Object.freeze({
  special: 0,
  danger: 1,
  warning: 2,
  advisory: 3,
});

/** 設計書 §3.3 のコード表(2桁化)。ラベルは表の文字列を固定で使う。 */
const SPECIAL_CODES: readonly [string, string][] = [
  ['32', '暴風雪特別警報'],
  ['33', 'レベル5大雨特別警報'],
  ['35', '暴風特別警報'],
  ['36', '大雪特別警報'],
  ['37', '波浪特別警報'],
  ['38', 'レベル5高潮特別警報'],
  ['39', 'レベル5土砂災害特別警報'],
];

const DANGER_CODES: readonly [string, string][] = [
  ['43', 'レベル4大雨危険警報'],
  ['48', 'レベル4高潮危険警報'],
  ['49', 'レベル4土砂災害危険警報'],
];

const WARNING_CODES: readonly [string, string][] = [
  ['02', '暴風雪警報'],
  ['03', 'レベル3大雨警報'],
  ['04', '洪水警報'],
  ['05', '暴風警報'],
  ['06', '大雪警報'],
  ['07', '波浪警報'],
  ['08', 'レベル3高潮警報'],
  ['09', 'レベル3土砂災害警報'],
];

const ADVISORY_CODES: readonly [string, string][] = [
  ['10', 'レベル2大雨注意報'],
  ['19', 'レベル2高潮注意報'],
  ['29', 'レベル2土砂災害注意報'],
  ['12', '大雪注意報'],
  ['13', '風雪注意報'],
  ['14', '雷注意報'],
  ['15', '強風注意報'],
  ['16', '波浪注意報'],
  ['17', '融雪注意報'],
  ['18', '洪水注意報'],
  ['20', '濃霧注意報'],
  ['21', '乾燥注意報'],
  ['22', 'なだれ注意報'],
  ['23', '低温注意報'],
  ['24', '霜注意報'],
  ['25', '着氷注意報'],
  ['26', '着雪注意報'],
  ['27', 'その他の注意報'],
];

function buildStageTable(
  stage: WarningStage,
  entries: readonly [string, string][],
): Record<string, WarningBadgeDefinition> {
  const table: Record<string, WarningBadgeDefinition> = {};
  entries.forEach(([code, label], index) => {
    table[code] = { code, stage, label, order: index };
  });
  return table;
}

export const WARNING_BADGE_TABLE: Readonly<Record<string, WarningBadgeDefinition>> = Object.freeze({
  ...buildStageTable('special', SPECIAL_CODES),
  ...buildStageTable('danger', DANGER_CODES),
  ...buildStageTable('warning', WARNING_CODES),
  ...buildStageTable('advisory', ADVISORY_CODES),
});

export type WarningChange = 'new' | 'strengthened' | 'weakened' | null;

/** §4.3 の表の判定順そのまま。差し替えやすいよう単一関数にまとめる。 */
const WEAKENED_STATUSES = new Set([
  '特別警報から危険警報',
  '特別警報から警報',
  '特別警報から注意報',
  '危険警報から警報',
  '危険警報から注意報',
  '警報から注意報',
]);

export function resolveWarningChange(item: WarningCurrentItem): WarningChange {
  if (WEAKENED_STATUSES.has(item.kindStatus)) {
    return 'weakened';
  }

  if (item.kindStatus === '発表') {
    if (item.lastKindCode === null) {
      return 'new';
    }
    const currentDef = WARNING_BADGE_TABLE[item.kindCode];
    const lastDef = WARNING_BADGE_TABLE[item.lastKindCode];
    if (currentDef !== undefined && lastDef !== undefined) {
      const lastStageOrder = STAGE_ORDER[lastDef.stage];
      const currentStageOrder = STAGE_ORDER[currentDef.stage];
      // 表内の段階順は special(0) が最上位のため、数値が大きいほど段階が低い。
      if (lastStageOrder > currentStageOrder) {
        return 'strengthened';
      }
    }
    return null;
  }

  return null;
}

export interface WarningBadge {
  readonly code: string;
  readonly stage: WarningStage;
  readonly label: string;
  readonly change: WarningChange;
}

/** 表にあるコードだけを段階順→段階内固定順で返す。表にないコードは除き、件数を別に返す */
export function buildWarningBadges(items: readonly WarningCurrentItem[]): {
  readonly badges: readonly WarningBadge[];
  readonly unknownCodes: readonly string[];
} {
  const badges: WarningBadge[] = [];
  const unknownCodes: string[] = [];

  for (const item of items) {
    const def = WARNING_BADGE_TABLE[item.kindCode];
    if (def === undefined) {
      unknownCodes.push(item.kindCode);
      continue;
    }
    badges.push({
      code: def.code,
      stage: def.stage,
      label: def.label,
      change: resolveWarningChange(item),
    });
  }

  badges.sort((a, b) => {
    const stageDiff = STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage];
    if (stageDiff !== 0) {
      return stageDiff;
    }
    const aOrder = WARNING_BADGE_TABLE[a.code]?.order ?? 0;
    const bOrder = WARNING_BADGE_TABLE[b.code]?.order ?? 0;
    return aOrder - bOrder;
  });

  return { badges, unknownCodes };
}

/**
 * §4.4 occasional 規則に基づき、応答からカード入力列を作る。
 * items が空、data が null、issuedAt が null(items 非空時)のときは 0 件を返す。
 */
export function buildWarningCards(
  response: WarningsResponse,
  availability: 'available' | 'stale',
): readonly InfoPanelCardInput[] {
  if (response.data === null) {
    return [];
  }

  const items = response.data.items;
  if (items.length === 0) {
    return [];
  }

  if (response.metadata.issuedAt === null) {
    return [];
  }

  const { badges } = buildWarningBadges(items);
  if (badges.length === 0) {
    return [];
  }

  return [
    {
      key: 'warning',
      heading: '気象警報・注意報',
      status: {
        kind: 'data',
        availability,
        time: response.metadata.issuedAt,
        timeKind: 'issued',
      },
      content: createElement(WarningBadgeList, { badges }),
    },
  ];
}
