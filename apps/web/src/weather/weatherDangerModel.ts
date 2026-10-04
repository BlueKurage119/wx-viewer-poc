import type { EarlyWarningResponse, WarningsResponse } from '@wx-viewer-poc/shared';
import type { InfoPanelCardInput } from '../map/panels/panelDefinitions';
import { WARNING_BADGE_TABLE, type WarningStage } from '../map/panels/warning/warningBadges';
import { buildDetailTable } from '../map/panels/earlyWarning/earlyWarningModel';

export type WeatherDangerLevel = 1 | 2 | 3 | 4 | 5;
const STAGE_LEVEL: Record<WarningStage, WeatherDangerLevel> = {
  special: 5,
  danger: 4,
  warning: 3,
  advisory: 2,
};
export function resolveHighestDangerLevel(
  levels: readonly (WeatherDangerLevel | null)[],
): WeatherDangerLevel | null {
  return levels.reduce<WeatherDangerLevel | null>(
    (highest, level) => (level !== null && (highest === null || level > highest) ? level : highest),
    null,
  );
}
export function resolveWarningDangerLevel(response: WarningsResponse): WeatherDangerLevel | null {
  if (!response.data || response.metadata.availability === 'unavailable') return null;
  return resolveHighestDangerLevel(
    response.data.items.map((item) => {
      const definition = WARNING_BADGE_TABLE[item.kindCode];
      return definition ? STAGE_LEVEL[definition.stage] : null;
    }),
  );
}
export function resolveEarlyWarningDangerLevel(
  response: EarlyWarningResponse,
  nowMs: number,
): 1 | null {
  const table = buildDetailTable(response);
  return table.columns.some(
    (column, index) =>
      Number.isFinite(Date.parse(column.timeFrom)) &&
      Date.parse(column.timeFrom) < Date.parse(column.timeTo) &&
      Date.parse(column.timeTo) > nowMs &&
      table.rows.some((row) => row.cells[index] === 'medium' || row.cells[index] === 'high'),
  )
    ? 1
    : null;
}
export function resolveBulletinDangerLevel(cards: readonly InfoPanelCardInput[]): 4 | null {
  return cards.length > 0 ? 4 : null;
}
