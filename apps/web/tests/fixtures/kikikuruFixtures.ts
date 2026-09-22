import type {
  KikikuruTimesResponse,
  KikikuruApiFrame,
  KikikuruApiLayer,
} from '@wx-viewer-poc/shared';

/**
 * 10分刻み 37 コマ (6時間分) のキキクルフレーム群を生成するヘルパー (§3.1 実測に基づく)
 * 最新 3 コマは immed0, immed1, immed2、それ以前は none
 */
export function createSampleKikikuruFrames(
  layer: KikikuruApiLayer,
  latestTimeIso: string = '2026-09-15T03:00:00.000Z',
  count: number = 37,
): KikikuruApiFrame[] {
  const imageId = layer === 'heavyrain' ? 'rain_mesh' : layer === 'inund' ? 'inund' : 'land';
  const latestMs = new Date(latestTimeIso).getTime();
  const frames: KikikuruApiFrame[] = [];

  for (let i = count - 1; i >= 0; i--) {
    // 10 分刻みで過去方向へ
    const frameMs = latestMs - (count - 1 - i) * 10 * 60 * 1000;
    const iso = new Date(frameMs).toISOString();

    const reverseIndex = count - 1 - i;
    let member = 'none';
    if (reverseIndex === 0) member = 'immed0';
    else if (reverseIndex === 1) member = 'immed1';
    else if (reverseIndex === 2) member = 'immed2';

    frames.push({
      layer,
      baseTime: iso,
      validTime: iso,
      imageId,
      member,
    });
  }

  // 昇順にソート (最古 -> 最新)
  return frames.sort((a, b) => Date.parse(a.validTime) - Date.parse(b.validTime));
}

/**
 * テスト用固定応答ヘルパー (KikikuruTimesResponse)
 */
export function createSampleKikikuruResponse(
  overrides?: Partial<KikikuruTimesResponse>,
): KikikuruTimesResponse {
  const latestTime = '2026-09-15T03:00:00.000Z';

  const heavyrainFrames = createSampleKikikuruFrames('heavyrain', latestTime);
  const inundFrames = createSampleKikikuruFrames('inund', latestTime);
  const landFrames = createSampleKikikuruFrames('land', latestTime);

  return {
    tileDeliveryProfile: 'proxy',
    terminalId: 'hkeagh01',
    venueId: 'east',
    controlStatus: 'normal',
    isTraining: false,
    evaluatedAt: latestTime,
    status: 'ok',
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
    layers: {
      heavyrain: {
        metadata: {
          source: 'jma_kikikuru',
          availability: 'available',
          issuedAt: latestTime,
          validAt: latestTime,
          validFrom: heavyrainFrames[0]?.validTime ?? null,
          validTo: latestTime,
          fetchedAt: '2026-09-15T03:00:10.000Z',
          lastSuccessAt: '2026-09-15T03:00:10.000Z',
          sourceVersion: null,
        },
        data: {
          frames: heavyrainFrames,
        },
      },
      inund: {
        metadata: {
          source: 'jma_kikikuru',
          availability: 'available',
          issuedAt: latestTime,
          validAt: latestTime,
          validFrom: inundFrames[0]?.validTime ?? null,
          validTo: latestTime,
          fetchedAt: '2026-09-15T03:00:10.000Z',
          lastSuccessAt: '2026-09-15T03:00:10.000Z',
          sourceVersion: null,
        },
        data: {
          frames: inundFrames,
        },
      },
      land: {
        metadata: {
          source: 'jma_kikikuru',
          availability: 'available',
          issuedAt: latestTime,
          validAt: latestTime,
          validFrom: landFrames[0]?.validTime ?? null,
          validTo: latestTime,
          fetchedAt: '2026-09-15T03:00:10.000Z',
          lastSuccessAt: '2026-09-15T03:00:10.000Z',
          sourceVersion: null,
        },
        data: {
          frames: landFrames,
        },
      },
    },
    ...overrides,
  };
}
