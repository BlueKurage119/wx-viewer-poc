import {
  TILE_API_ALLOWED_ZOOMS,
  type KikikuruApiDataset,
  type KikikuruApiFrame,
  type KikikuruApiLayer,
  type KikikuruTimesResponse,
  type TerminalDefinition,
  type TileCoordinate,
  type TileUpstreamAccess,
  type UtcIso8601String,
  type WeatherControlStatus,
  type WeatherMetadata,
} from '@wx-viewer-poc/shared';
import type { KikikuruService } from '../polling/kikikuruService.js';
import {
  createStaticTileDeliveryProfileService,
  type TileDeliveryProfileService,
} from './tileDeliveryProfileService.js';
import {
  ImageServicesInitializingError,
  projectUpstreamAccess,
  type TileDeliveryResult,
} from './tileApiSupport.js';

export interface KikikuruApiServiceDependencies {
  readonly getService: () => KikikuruService | null;
  readonly enablePolling: boolean;
  readonly tileDeliveryProfileService?: TileDeliveryProfileService;
  readonly allowedZooms?: readonly number[];
  readonly clock?: () => UtcIso8601String;
}

export interface KikikuruApiService {
  getTimes(
    terminal: TerminalDefinition,
    controlStatus: WeatherControlStatus,
  ): KikikuruTimesResponse;
  getTile(frame: KikikuruApiFrame, coordinate: TileCoordinate): Promise<TileDeliveryResult>;
}

const UNAVAILABLE_EMPTY_METADATA: WeatherMetadata = {
  source: null,
  issuedAt: null,
  validAt: null,
  validFrom: null,
  validTo: null,
  fetchedAt: null,
  lastSuccessAt: null,
  availability: 'unavailable',
  sourceVersion: null,
};

const KIKIKURU_LAYERS: readonly KikikuruApiLayer[] = ['heavyrain', 'inund', 'land'];

export function createKikikuruApiService(
  dependencies: KikikuruApiServiceDependencies,
): KikikuruApiService {
  const clock = dependencies.clock ?? (() => new Date().toISOString() as UtcIso8601String);
  const allowedZooms = dependencies.allowedZooms ?? TILE_API_ALLOWED_ZOOMS;
  const tileDeliveryProfileService =
    dependencies.tileDeliveryProfileService ?? createStaticTileDeliveryProfileService('proxy');

  return {
    getTimes(
      terminal: TerminalDefinition,
      controlStatus: WeatherControlStatus,
    ): KikikuruTimesResponse {
      if (controlStatus !== 'normal') {
        return {
          tileDeliveryProfile: tileDeliveryProfileService.getProfile(terminal),
          terminalId: terminal.id,
          venueId: terminal.venueId,
          controlStatus,
          isTraining: controlStatus === 'training',
          evaluatedAt: clock(),
          status: 'unsupported_control_status',
          catalogAccess: null,
          imageAccess: null,
          allowedZooms: [],
          layers: {
            heavyrain: { metadata: UNAVAILABLE_EMPTY_METADATA, data: null },
            inund: { metadata: UNAVAILABLE_EMPTY_METADATA, data: null },
            land: { metadata: UNAVAILABLE_EMPTY_METADATA, data: null },
          },
        };
      }

      const service = dependencies.getService();
      if (service === null) {
        throw new ImageServicesInitializingError();
      }

      const catalog = service.readCatalog();
      const catalogAccess = projectUpstreamAccess(
        catalog.catalogAccess,
        dependencies.enablePolling,
      );
      const imageAccess = projectUpstreamAccess(catalog.imageAccess, dependencies.enablePolling);

      const projectLayer = (layer: KikikuruApiLayer): KikikuruApiDataset => {
        const layerCatalog = catalog.layers[layer];
        const snapshot = layerCatalog.snapshot;
        if (!snapshot) {
          return {
            metadata: UNAVAILABLE_EMPTY_METADATA,
            data: null,
          };
        }

        const metadata: WeatherMetadata = {
          source: snapshot.metadata.source,
          issuedAt: snapshot.metadata.issuedAt,
          validAt: snapshot.metadata.validAt,
          validFrom: snapshot.metadata.validFrom,
          validTo: snapshot.metadata.validTo,
          fetchedAt: snapshot.metadata.fetchedAt,
          lastSuccessAt: snapshot.metadata.lastSuccessAt,
          availability: layerCatalog.availability,
          sourceVersion: snapshot.metadata.sourceVersion,
        };

        const data =
          snapshot.metadata.lastSuccessAt === null
            ? null
            : {
                frames: layerCatalog.frames.map((f) => ({
                  layer,
                  baseTime: f.baseTime,
                  validTime: f.validTime,
                  imageId: f.imageId as 'rain_mesh' | 'inund' | 'land',
                  member: f.member,
                })),
              };

        return {
          metadata,
          data,
        };
      };

      const layers = {} as Record<KikikuruApiLayer, KikikuruApiDataset>;
      for (const layer of KIKIKURU_LAYERS) {
        layers[layer] = projectLayer(layer);
      }

      return {
        tileDeliveryProfile: tileDeliveryProfileService.getProfile(terminal),
        terminalId: terminal.id,
        venueId: terminal.venueId,
        controlStatus: 'normal',
        isTraining: false,
        evaluatedAt: catalog.now,
        status: 'ok',
        catalogAccess,
        imageAccess,
        allowedZooms,
        layers,
      };
    },

    async getTile(
      frame: KikikuruApiFrame,
      coordinate: TileCoordinate,
    ): Promise<TileDeliveryResult> {
      const service = dependencies.getService();
      if (service === null) {
        throw new ImageServicesInitializingError();
      }

      try {
        const results = await service.fetchFrameTiles(frame, [coordinate]);
        if (!Array.isArray(results) || results.length !== 1 || !results[0]) {
          return {
            kind: 'error',
            httpStatus: 500,
            error: { status: 'error', code: 'tile_read_failed' },
          };
        }

        const result = results[0];

        if (result.kind === 'unavailable') {
          if (result.errorKind === 'frame_not_available') {
            return {
              kind: 'error',
              httpStatus: 404,
              error: {
                status: 'error',
                code: 'frame_not_available',
                catalogAvailability: result.availability,
              },
            };
          }

          if (result.errorKind === 'scheduled_stopped') {
            let imageAccess: TileUpstreamAccess | undefined;
            try {
              const currentCatalog = service.readCatalog();
              imageAccess = projectUpstreamAccess(
                currentCatalog.imageAccess,
                dependencies.enablePolling,
              );
            } catch {
              return {
                kind: 'error',
                httpStatus: 500,
                error: {
                  status: 'error',
                  code: 'tile_read_failed',
                  catalogAvailability: result.availability,
                },
              };
            }
            return {
              kind: 'error',
              httpStatus: 503,
              error: {
                status: 'error',
                code: 'acquisition_stopped',
                catalogAvailability: result.availability,
                imageAccess,
              },
            };
          }

          if (
            result.errorKind === 'http_status' ||
            result.errorKind === 'timeout' ||
            result.errorKind === 'network' ||
            result.errorKind === 'invalid_png' ||
            result.errorKind === 'fetch_failed'
          ) {
            return {
              kind: 'error',
              httpStatus: 502,
              error: {
                status: 'error',
                code: 'tile_fetch_failed',
                catalogAvailability: result.availability,
              },
            };
          }

          if (result.errorKind === 'invalid_coordinate') {
            return {
              kind: 'error',
              httpStatus: 400,
              error: {
                status: 'error',
                code: 'invalid_request',
              },
            };
          }

          return {
            kind: 'error',
            httpStatus: 500,
            error: {
              status: 'error',
              code: 'tile_read_failed',
              catalogAvailability: result.availability,
            },
          };
        }

        let buffer: Buffer | null = null;
        try {
          buffer = await service.readVerifiedTile(result.tile!);
        } catch {
          return {
            kind: 'error',
            httpStatus: 500,
            error: {
              status: 'error',
              code: 'tile_read_failed',
              catalogAvailability: result.availability,
            },
          };
        }

        if (buffer === null) {
          return {
            kind: 'error',
            httpStatus: 500,
            error: {
              status: 'error',
              code: 'tile_read_failed',
              catalogAvailability: result.availability,
            },
          };
        }

        return {
          kind: 'success',
          buffer,
          catalogAvailability: result.availability,
          tileResult: result.kind,
          storedAt: result.tile!.storedAt,
        };
      } catch {
        return {
          kind: 'error',
          httpStatus: 500,
          error: {
            status: 'error',
            code: 'tile_read_failed',
          },
        };
      }
    },
  };
}
