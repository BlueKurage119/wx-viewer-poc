import type {
  MonitoringInformationKind,
  MonitoringStatusResponse,
  VenueForecastTargets,
  VenueId,
} from '@wx-viewer-poc/shared';
import { resolveVenueForecastTargets } from '@wx-viewer-poc/shared';
import { formatJstMonthDayClock } from './monitoringTimeFormat.js';

/** 反映状態の表示語。K7は3値と欠落のみ。K8で異常系を追加する。 */
export type InformationStateLabel = '利用可能' | '情報なし' | '未取得' | '—';

export type InformationStateTone = 'normal' | 'neutral' | 'unknown';

export interface InformationRow {
  readonly kind: MonitoringInformationKind;
  /** 行見出し。固定8行。 */
  readonly name: string;
  /** 対象地域・地点。解決できない場合と雨雲・キキクルは '—'（§4.5）。 */
  readonly target: string;
  readonly stateLabel: InformationStateLabel;
  readonly stateTone: InformationStateTone;
  /** 情報時刻（基準時刻）の表示文字列。JST MM/DD HH:mm:ss。null は '—'。 */
  readonly validAtText: string;
  /** <time dateTime> へ渡す生値。null なら time 要素を出さない。 */
  readonly validAt: string | null;
  readonly fetchedAtText: string;
  readonly fetchedAt: string | null;
  /** 件数。null は '—'、0 は '0'。 */
  readonly summaryCountText: string;
}

export interface InformationRowDefinition {
  readonly kind: MonitoringInformationKind;
  readonly name: string;
}

export const INFORMATION_ROW_DEFINITIONS: readonly InformationRowDefinition[] = [
  { kind: 'bosai_bulletin', name: '気象防災速報' },
  { kind: 'warning', name: '気象警報・注意報' },
  { kind: 'warning_timeseries', name: '警報等時系列' },
  { kind: 'early_warning', name: '警報級の可能性' },
  { kind: 'amedas', name: 'アメダス' },
  { kind: 'area_timeseries', name: '地域時系列予報' },
  { kind: 'nowcast', name: '雨雲' },
  { kind: 'kikikuru', name: 'キキクル' },
] as const;

export type VenueForecastTargetsResolver = (venueId: VenueId) => VenueForecastTargets | undefined;

function resolveTargetDisplayName(
  kind: MonitoringInformationKind,
  targets: VenueForecastTargets | undefined,
): string {
  if (!targets) {
    return '—';
  }

  switch (kind) {
    case 'bosai_bulletin': {
      // §4.5.1 気象防災速報の市区町村名の流用条件
      // 1. targets.bosaiBulletin.includedAreaCodes に targets.warning.municipalCode と同じ値が含まれることを確認
      // 2. 含まれる場合のみ targets.warning.displayName を表示
      // 3. 含まれない場合、includedAreaCodes が空の場合、または会場定義が解決できない場合は '—'
      const municipalCode = targets.warning?.municipalCode;
      const included = targets.bosaiBulletin?.includedAreaCodes;
      if (
        municipalCode &&
        included &&
        included.length > 0 &&
        included.some((code) => (code as string) === (municipalCode as string))
      ) {
        return targets.warning.displayName;
      }
      return '—';
    }
    case 'warning':
      return targets.warning?.displayName ?? '—';
    case 'warning_timeseries':
      return targets.warningTimeseries?.displayName ?? '—';
    case 'early_warning':
      return targets.broadForecast?.displayName ?? '—';
    case 'amedas':
      return targets.amedas?.displayName ?? '—';
    case 'area_timeseries':
      return targets.broadForecast?.displayName ?? '—';
    case 'nowcast':
    case 'kikikuru':
      // §4.5 雨雲・キキクルは表示しない ('—')
      return '—';
  }
}

/**
 * requestedVenueId の情報だけを固定8行へ整形する。
 * 時刻・閾値からの再判定、availability の丸め、件数からの状態推定は行わない。
 * data が null のときは全セル '—' の8行を返す（K6 buildSourceStatusRows と同じ方針）。
 */
export function buildInformationRows(
  data: MonitoringStatusResponse | null,
  resolveTargets: VenueForecastTargetsResolver = resolveVenueForecastTargets,
): readonly InformationRow[] {
  if (!data) {
    return INFORMATION_ROW_DEFINITIONS.map((def) => ({
      kind: def.kind,
      name: def.name,
      target: '—',
      stateLabel: '—',
      stateTone: 'unknown',
      validAtText: '—',
      validAt: null,
      fetchedAtText: '—',
      fetchedAt: null,
      summaryCountText: '—',
    }));
  }

  // requestedVenueId のみ抽出し、kind ごとのマップを作成
  const requestedVenueId = data.requestedVenueId;
  const sectionMap = new Map<MonitoringInformationKind, (typeof data.information)[number]>();
  for (const info of data.information) {
    if (info.venueId === requestedVenueId) {
      sectionMap.set(info.kind, info);
    }
  }

  let targets: VenueForecastTargets | undefined;
  try {
    targets = resolveTargets(requestedVenueId);
  } catch {
    targets = undefined;
  }

  return INFORMATION_ROW_DEFINITIONS.map((def) => {
    const section = sectionMap.get(def.kind);

    // 要素なしの場合は全セル '—'（§4.1, AC-11）
    if (!section) {
      return {
        kind: def.kind,
        name: def.name,
        target: '—',
        stateLabel: '—',
        stateTone: 'unknown',
        validAtText: '—',
        validAt: null,
        fetchedAtText: '—',
        fetchedAt: null,
        summaryCountText: '—',
      };
    }

    const target = resolveTargetDisplayName(def.kind, targets);

    // 反映状態 (§4.2)
    let stateLabel: InformationStateLabel;
    let stateTone: InformationStateTone;
    switch (section.availability) {
      case 'available':
        stateLabel = '利用可能';
        stateTone = 'normal';
        break;
      case 'stale':
        stateLabel = '情報なし';
        stateTone = 'neutral';
        break;
      case 'unavailable':
        stateLabel = '未取得';
        stateTone = 'neutral';
        break;
    }

    // 情報時刻 (validAt) と反映時刻 (fetchedAt) (§4.3)
    const validAt = section.validAt;
    const validAtText = formatJstMonthDayClock(validAt);

    const fetchedAt = section.fetchedAt;
    const fetchedAtText = formatJstMonthDayClock(fetchedAt);

    // 有効な情報件数 (§4.4)
    const summaryCountText = section.summaryCount === null ? '—' : section.summaryCount.toString();

    return {
      kind: def.kind,
      name: def.name,
      target,
      stateLabel,
      stateTone,
      validAtText,
      validAt,
      fetchedAtText,
      fetchedAt,
      summaryCountText,
    };
  });
}
