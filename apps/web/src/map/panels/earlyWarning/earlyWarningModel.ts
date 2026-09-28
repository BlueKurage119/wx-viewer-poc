import type {
  EarlyWarningCell,
  EarlyWarningData,
  EarlyWarningResponse,
  WeatherDataset,
} from '@wx-viewer-poc/shared';

export type Segment = 'near' | 'far';
export type WarningCellKind = 'high' | 'medium' | 'none' | 'noValue' | 'missing' | 'outOfRange';
export interface WarningColumn {
  readonly key: string;
  readonly segment: Segment;
  readonly timeId: string;
  readonly timeFrom: string;
  readonly timeTo: string;
  readonly label: string;
}
export interface WarningRow {
  readonly key: string;
  readonly label: string;
  readonly cells: readonly WarningCellKind[];
}
export interface WarningTable {
  readonly columns: readonly WarningColumn[];
  readonly rows: readonly WarningRow[];
  readonly rainJoined: boolean;
}

const NAMES = ['大雨', '土砂災害', '大雪', '暴風（雪）', '波浪', '高潮'] as const;
const CODES: Readonly<Record<string, string>> = {
  大雨の警報級の可能性: '大雨',
  土砂災害の警報級の可能性: '土砂災害',
  雪の警報級の可能性: '大雪',
  '風（風雪）の警報級の可能性': '暴風（雪）',
  波の警報級の可能性: '波浪',
  潮位の警報級の可能性: '高潮',
  雨の警報級の可能性: '雨',
};
const DAY = 86400000;
function jstDay(iso: string): number {
  return Math.floor((Date.parse(iso) + 9 * 3600000) / DAY);
}
function label(from: string, to: string): string {
  const a = new Date(Date.parse(from) + 9 * 3600000);
  const b = new Date(Date.parse(to) + 9 * 3600000);
  const date = `${a.getUTCMonth() + 1}/${a.getUTCDate()}`;
  if (Date.parse(to) - Date.parse(from) >= DAY) return date;
  const endHour = jstDay(to) > jstDay(from) && b.getUTCHours() === 0 ? 24 : b.getUTCHours();
  return `${date} ${a.getUTCHours()}-${endHour}`;
}
function dataset(
  response: EarlyWarningResponse,
  segment: Segment,
): WeatherDataset<EarlyWarningData> {
  return response[segment];
}
export function available(response: EarlyWarningResponse, segment: Segment): boolean {
  const entry = dataset(response, segment);
  return entry.data !== null && entry.metadata.availability !== 'unavailable';
}
export function columnsFor(
  response: EarlyWarningResponse,
  segment: Segment,
): readonly WarningColumn[] {
  if (!available(response, segment)) return [];
  const entry = dataset(response, segment);
  const issued = entry.metadata.issuedAt;
  const startDay = issued === null ? null : jstDay(issued) + 3;
  return (entry.data?.timeDefines ?? [])
    .filter((td) => segment === 'near' || startDay === null || jstDay(td.timeFrom) >= startDay)
    .slice()
    .sort(
      (a, b) =>
        Date.parse(a.timeFrom) - Date.parse(b.timeFrom) ||
        Date.parse(a.timeTo) - Date.parse(b.timeTo) ||
        a.sequence - b.sequence,
    )
    .map((td) => ({
      key: `${segment}:${td.timeId}:${td.sequence}`,
      segment,
      timeId: td.timeId,
      timeFrom: td.timeFrom,
      timeTo: td.timeTo,
      label: label(td.timeFrom, td.timeTo),
    }));
}
export function classify(cell: EarlyWarningCell | undefined): WarningCellKind {
  if (!cell) return 'missing';
  if (cell.condition === '値なし') return 'noValue';
  if (cell.condition !== null) return 'missing';
  if (cell.rankValue === '高') return 'high';
  if (cell.rankValue === '中') return 'medium';
  if (cell.rankValue === 'なし') return 'none';
  return 'missing';
}
function cellName(cell: EarlyWarningCell): string {
  return CODES[cell.phenomenonCode] ?? CODES[cell.phenomenonName] ?? cell.phenomenonName;
}
export function buildTable(
  response: EarlyWarningResponse,
  segment: Segment,
  columns = columnsFor(response, segment),
): WarningTable {
  const data = dataset(response, segment).data;
  if (!data) return { columns: [], rows: [], rainJoined: false };
  const names = new Set(data.cells.map(cellName));
  const rainJoined = segment === 'far' && names.has('雨');
  const known = NAMES.filter(
    (name) => names.has(name) || (rainJoined && (name === '大雨' || name === '土砂災害')),
  );
  const unknown = [...names].filter(
    (name) => !NAMES.includes(name as (typeof NAMES)[number]) && name !== '雨',
  );
  const rows = [...known, ...unknown].map((name) => ({
    key: name,
    label: name,
    cells: columns.map((column) => {
      const target = rainJoined && (name === '大雨' || name === '土砂災害') ? '雨' : name;
      if (!names.has(target)) return 'outOfRange' as const;
      return classify(
        data.cells.find((cell) => cell.refId === column.timeId && cellName(cell) === target),
      );
    }),
  }));
  return { columns, rows, rainJoined };
}
/** パネルは現在コマ（無ければ未来の先頭）から最大3コマだけ使う。 */
export function selectPanelColumns(
  columns: readonly WarningColumn[],
  now: number,
): readonly WarningColumn[] {
  const current = columns.findIndex(
    (column) => Date.parse(column.timeFrom) <= now && now < Date.parse(column.timeTo),
  );
  const firstFuture = columns.findIndex((column) => Date.parse(column.timeFrom) > now);
  const start = current >= 0 ? current : firstFuture;
  return start < 0 ? [] : columns.slice(start, start + 3);
}

export function buildPanelTable(response: EarlyWarningResponse, now: number): WarningTable {
  const columns = selectPanelColumns(columnsFor(response, 'near'), now);
  const table = buildTable(response, 'near', columns);
  return {
    ...table,
    rows: table.rows.filter((row) =>
      row.cells.some((cell) => cell === 'high' || cell === 'medium'),
    ),
  };
}

export function buildDetailTable(response: EarlyWarningResponse): WarningTable {
  const near = columnsFor(response, 'near');
  const occupied: { from: number; to: number }[] = [];
  // 開始順の近距離列を統合し、穴を埋めずに被覆範囲を求める。
  for (const column of near) {
    const from = Date.parse(column.timeFrom);
    const to = Date.parse(column.timeTo);
    const previous = occupied.at(-1);
    if (previous && from <= previous.to) {
      previous.to = Math.max(previous.to, to);
    } else {
      occupied.push({ from, to });
    }
  }
  const far = columnsFor(response, 'far').filter(
    (column) =>
      !occupied.some(
        (range) =>
          range.from <= Date.parse(column.timeFrom) && Date.parse(column.timeTo) <= range.to,
      ),
  );
  const columns = [...near, ...far].sort(
    (a, b) =>
      Date.parse(a.timeFrom) - Date.parse(b.timeFrom) ||
      Date.parse(a.timeTo) - Date.parse(b.timeTo),
  );
  const nearTable = buildTable(response, 'near', near);
  const farTable = buildTable(response, 'far', far);
  const names = new Set([
    ...nearTable.rows.map((row) => row.key),
    ...farTable.rows.map((row) => row.key),
  ]);
  const ordered = [
    ...NAMES.filter((name) => names.has(name)),
    ...[...names].filter((name) => !NAMES.includes(name as (typeof NAMES)[number])),
  ];
  return {
    columns,
    rainJoined: farTable.rainJoined,
    rows: ordered.map((name) => ({
      key: name,
      label: name,
      cells: columns.map((column) => {
        const table = column.segment === 'near' ? nearTable : farTable;
        const row = table.rows.find((item) => item.key === name);
        const index = table.columns.findIndex((item) => item.key === column.key);
        return row?.cells[index] ?? 'outOfRange';
      }),
    })),
  };
}
