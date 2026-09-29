import type {
  EarlyWarningCell,
  EarlyWarningData,
  EarlyWarningResponse,
  WeatherDataset,
  WeatherMetadata,
  VenueId,
} from '@wx-viewer-poc/shared';

const EAST_FIXTURE_VENUE_ID = 'east' as VenueId;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const JST = 9 * HOUR;

function metadata(issuedAt: string): WeatherMetadata {
  return {
    source: null,
    issuedAt,
    validAt: null,
    validFrom: null,
    validTo: null,
    fetchedAt: null,
    lastSuccessAt: null,
    availability: 'available',
    sourceVersion: null,
  };
}

function cell(
  refId: string,
  phenomenonCode: string,
  rankValue: string | null,
  condition: string | null = null,
): EarlyWarningCell {
  return { refId, phenomenonCode, phenomenonName: phenomenonCode, rankValue, condition };
}

function dataset(
  segment: 'near' | 'far',
  issuedAt: string,
  starts: readonly number[],
  duration: number,
  cells: readonly EarlyWarningCell[],
): WeatherDataset<EarlyWarningData> {
  return {
    area: { code: '130010', name: '東京地方' },
    metadata: metadata(issuedAt),
    data: {
      segment,
      telegramType: segment === 'near' ? 'VPFD61' : 'VPFW60',
      timeDefines: starts.map((start, index) => ({
        timeId: `${segment}-${index + 1}`,
        sequence: index,
        timeFrom: new Date(start).toISOString(),
        timeTo: new Date(start + duration).toISOString(),
        duration: null,
      })),
      cells,
    },
  };
}

/** 現在を含む6時間区間と、同じJST基準日のD+3以降を組み立てる。 */
export function buildEarlyWarningFixtureResponse(now: number = Date.now()): EarlyWarningResponse {
  const jstDayStart = Math.floor((now + JST) / DAY) * DAY - JST;
  const nearStart = jstDayStart + Math.floor((now - jstDayStart) / (6 * HOUR)) * 6 * HOUR;
  const nearStarts = [nearStart, nearStart + 6 * HOUR, nearStart + 12 * HOUR];
  const farStarts = [jstDayStart + 3 * DAY, jstDayStart + 4 * DAY, jstDayStart + 5 * DAY];
  const nearRef = (index: number) => `near-${index}`;
  const farRef = (index: number) => `far-${index}`;
  const nearCells: readonly EarlyWarningCell[] = [
    cell(nearRef(1), '大雨の警報級の可能性', '高'),
    cell(nearRef(2), '大雨の警報級の可能性', 'なし'),
    cell(nearRef(3), '大雨の警報級の可能性', null, '値なし'),
    cell(nearRef(1), '土砂災害の警報級の可能性', '中'),
    // near-2 は参照欠落
    cell(nearRef(3), '土砂災害の警報級の可能性', 'なし'),
    cell(nearRef(1), '雪の警報級の可能性', null, '値なし'),
    cell(nearRef(2), '雪の警報級の可能性', '高'),
    cell(nearRef(3), '雪の警報級の可能性', null, '欠測'),
    cell(nearRef(1), '風（風雪）の警報級の可能性', 'なし'),
    cell(nearRef(2), '風（風雪）の警報級の可能性', 'なし'),
    cell(nearRef(3), '風（風雪）の警報級の可能性', 'なし'),
  ];
  const farCells: readonly EarlyWarningCell[] = [
    cell(farRef(1), '雨の警報級の可能性', '中'),
    cell(farRef(2), '雨の警報級の可能性', 'なし'),
    cell(farRef(3), '雨の警報級の可能性', null, '値なし'),
    cell(farRef(1), '雪の警報級の可能性', 'なし'),
    cell(farRef(2), '雪の警報級の可能性', '中'),
    cell(farRef(3), '雪の警報級の可能性', '高'),
    cell(farRef(1), '風（風雪）の警報級の可能性', '高'),
    cell(farRef(2), '風（風雪）の警報級の可能性', '中'),
    cell(farRef(3), '風（風雪）の警報級の可能性', 'なし'),
    cell(farRef(1), '波の警報級の可能性', '中'),
    cell(farRef(2), '波の警報級の可能性', 'なし'),
    cell(farRef(3), '波の警報級の可能性', null, '値なし'),
  ];
  const issuedAt = new Date(now).toISOString();
  return {
    terminalId: 'fixture-terminal',
    venueId: EAST_FIXTURE_VENUE_ID,
    controlStatus: 'normal',
    isTraining: false,
    evaluatedAt: issuedAt,
    near: dataset('near', issuedAt, nearStarts, 6 * HOUR, nearCells),
    far: dataset('far', issuedAt, farStarts, DAY, farCells),
  };
}
