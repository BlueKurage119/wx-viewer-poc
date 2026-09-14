import {
  TILE_API_ALLOWED_ZOOMS,
  type NowcastApiFrame,
  type NowcastApiProduct,
  type NowcastTimesResponse,
  type TerminalDefinition,
  type TileCoordinate,
  type TileUpstreamAccess,
  type UtcIso8601String,
  type WeatherControlStatus,
  type WeatherMetadata,
} from '@wx-viewer-poc/shared';
import type { NowcastService } from '../polling/nowcastService.js';
import {
  ImageServicesInitializingError,
  projectUpstreamAccess,
  type TileDeliveryResult,
} from './tileApiSupport.js';

export interface NowcastApiServiceDependencies {
  readonly getService: () => NowcastService | null;
  readonly enablePolling: boolean;
  readonly allowedZooms?: readonly number[];
  readonly clock?: () => UtcIso8601String;
}

export interface NowcastApiService {
  getTimes(terminal: TerminalDefinition, controlStatus: WeatherControlStatus): NowcastTimesResponse;
  getTile(frame: NowcastApiFrame, coordinate: TileCoordinate): Promise<TileDeliveryResult>;
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

export function createNowcastApiService(
  dependencies: NowcastApiServiceDependencies,
): NowcastApiService {
  const clock = dependencies.clock ?? (() => new Date().toISOString() as UtcIso8601String);
  const allowedZooms = dependencies.allowedZooms ?? TILE_API_ALLOWED_ZOOMS;

  return {
    getTimes(
      terminal: TerminalDefinition,
      controlStatus: WeatherControlStatus,
    ): NowcastTimesResponse {
      if (controlStatus !== 'normal') {
        return {
          terminalId: terminal.id,
          venueId: terminal.venueId,
          controlStatus,
          isTraining: controlStatus === 'training',
          evaluatedAt: clock(),
          status: 'unsupported_control_status',
          window: null,
          catalogAccess: null,
          imageAccess: null,
          allowedZooms: [],
          products: {
            N1: {
              metadata: UNAVAILABLE_EMPTY_METADATA,
              data: null,
            },
            N2: {
              metadata: UNAVAILABLE_EMPTY_METADATA,
              data: null,
            },
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

      const projectProduct = (product: 'N1' | 'N2'): NowcastApiProduct => {
        const prod = catalog.products[product];
        const snapshot = prod.snapshot;
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
          availability: prod.availability,
          sourceVersion: snapshot.metadata.sourceVersion,
        };

        const data =
          snapshot.metadata.lastSuccessAt === null
            ? null
            : {
                frames: prod.frames.map((f) => ({
                  product,
                  baseTime: f.baseTime,
                  validTime: f.validTime,
                  element: 'hrpns' as const,
                  member: 'none' as const,
                })),
              };

        return {
          metadata,
          data,
        };
      };

      return {
        terminalId: terminal.id,
        venueId: terminal.venueId,
        controlStatus: 'normal',
        isTraining: false,
        evaluatedAt: catalog.now,
        status: 'ok',
        window: catalog.window,
        catalogAccess,
        imageAccess,
        allowedZooms,
        products: {
          N1: projectProduct('N1'),
          N2: projectProduct('N2'),
        },
      };
    },

    async getTile(frame: NowcastApiFrame, coordinate: TileCoordinate): Promise<TileDeliveryResult> {
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
