import type { NowcastTimesResponse } from '@wx-viewer-poc/shared';

/**
 * テスト用固定応答ヘルパー (NowcastTimesResponse)
 * 既存台帳 ID (hkeagh01 / east) を使用。
 */
export function createSampleNowcastResponse(
  overrides?: Partial<NowcastTimesResponse>,
): NowcastTimesResponse {
  const baseEvaluatedAt = '2026-09-15T03:00:00.000Z';
  const fromTime = '2026-09-15T02:00:00.000Z'; // -60分
  const toTime = '2026-09-15T04:00:00.000Z'; // +60分

  // N1: 02:00 から 03:00 までの 5 分刻み 13 コマ (basetime == validtime)
  const n1Frames = [];
  for (let i = 0; i <= 12; i++) {
    const min = i * 5;
    const d = new Date(new Date(fromTime).getTime() + min * 60 * 1000);
    const iso = d.toISOString();
    n1Frames.push({
      product: 'N1' as const,
      baseTime: iso,
      validTime: iso,
      element: 'hrpns' as const,
      member: 'none' as const,
    });
  }

  // N2: basetime=02:55, validtime=03:00..03:55 の 12 コマ (+5分〜+60分)
  // 03:00 は N1 と重複する
  const n2Base = '2026-09-15T02:55:00.000Z';
  const n2Frames = [];
  for (let i = 1; i <= 12; i++) {
    const min = i * 5;
    const d = new Date(new Date(n2Base).getTime() + min * 60 * 1000);
    const iso = d.toISOString();
    n2Frames.push({
      product: 'N2' as const,
      baseTime: n2Base,
      validTime: iso,
      element: 'hrpns' as const,
      member: 'none' as const,
    });
  }

  return {
    terminalId: 'hkeagh01',
    venueId: 'east',
    controlStatus: 'normal',
    isTraining: false,
    evaluatedAt: baseEvaluatedAt,
    status: 'ok',
    window: {
      from: fromTime,
      to: toTime,
    },
    catalogAccess: {
      allowed: true,
      reason: null,
      nextAllowedAt: null,
    },
    imageAccess: {
      allowed: true,
      reason: null,
      nextAllowedAt: null,
    },
    allowedZooms: [10],
    products: {
      N1: {
        metadata: {
          source: 'jma_nowcast',
          availability: 'available',
          issuedAt: '2026-09-15T03:01:00.000Z',
          validAt: '2026-09-15T03:00:00.000Z',
          validFrom: null,
          validTo: null,
          fetchedAt: '2026-09-15T03:01:10.000Z',
          lastSuccessAt: '2026-09-15T03:01:10.000Z',
          sourceVersion: null,
        },
        data: {
          frames: n1Frames,
        },
      },
      N2: {
        metadata: {
          source: 'jma_nowcast',
          availability: 'available',
          issuedAt: '2026-09-15T02:57:00.000Z',
          validAt: null,
          validFrom: '2026-09-15T03:00:00.000Z',
          validTo: '2026-09-15T03:55:00.000Z',
          fetchedAt: '2026-09-15T02:57:15.000Z',
          lastSuccessAt: '2026-09-15T02:57:15.000Z',
          sourceVersion: null,
        },
        data: {
          frames: n2Frames,
        },
      },
    },
    ...overrides,
  };
}
