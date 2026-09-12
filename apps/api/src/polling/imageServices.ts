import path from 'node:path';
import type { UtcIso8601String } from '@wx-viewer-poc/shared';
import type { DatabaseConnection } from '../database/index.js';
import {
  getNextEnabledAt,
  resolveOnDemandAccess,
  resolvePollingPeriod,
  type OnDemandSource,
  type PollingScheduleConfig,
  type UpstreamAccess,
} from '../config/pollingSchedule.js';
import { NowcastService } from './nowcastService.js';
import { KikikuruService } from './kikikuruService.js';

export interface ImageServices {
  readonly nowcast: NowcastService;
  readonly kikikuru: KikikuruService;
  close(): Promise<void>;
}

export interface CreateImageServicesOptions {
  readonly connection: DatabaseConnection;
  readonly schedule: PollingScheduleConfig;
  readonly enablePolling?: boolean;
  readonly now?: () => Date;
  readonly fetchFn?: typeof fetch;
  readonly nowcastCacheRoot?: string;
  readonly kikikuruCacheRoot?: string;
}

function createClosedGuardProxy<T extends object>(target: T, isClosed: () => boolean): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const orig = Reflect.get(obj, prop, receiver);
      if (typeof orig === 'function') {
        return (...args: unknown[]) => {
          if (isClosed()) {
            throw new Error('ImageService is already closed');
          }
          return orig.apply(obj, args);
        };
      }
      return orig;
    },
  });
}

export function createImageServices(options: CreateImageServicesOptions): ImageServices {
  let isClosed = false;
  const nowFn = options.now ?? (() => new Date());
  const enablePolling = options.enablePolling ?? true;

  const getCatalogAccess = (): UpstreamAccess => {
    const now = nowFn();
    const period = resolvePollingPeriod(now, options.schedule);
    if (isClosed || !enablePolling) {
      return {
        allowed: false,
        period,
        nextAllowedAt: null,
      };
    }

    const allowed = period.imageCatalogSeconds !== null;
    let nextAllowedAt: string | null = null;
    if (allowed) {
      nextAllowedAt = now.toISOString();
    } else {
      const nextDate = getNextEnabledAt(
        { kind: 'scheduled', source: 'nowcast' },
        now,
        options.schedule,
      );
      nextAllowedAt = nextDate ? nextDate.toISOString() : null;
    }

    return {
      allowed,
      period,
      nextAllowedAt: nextAllowedAt as UtcIso8601String | null,
    };
  };

  const getImageAccess = (source: OnDemandSource): UpstreamAccess => {
    const now = nowFn();
    const period = resolvePollingPeriod(now, options.schedule);
    if (isClosed || !enablePolling) {
      return {
        allowed: false,
        period,
        nextAllowedAt: null,
      };
    }

    return resolveOnDemandAccess(source, now, options.schedule);
  };

  const nowcastCacheRoot =
    options.nowcastCacheRoot ?? path.resolve(process.cwd(), 'data/cache/nowcast');
  const kikikuruCacheRoot =
    options.kikikuruCacheRoot ?? path.resolve(process.cwd(), 'data/cache/kikikuru');

  const rawNowcast = new NowcastService(options.connection, {
    cacheRoot: nowcastCacheRoot,
    allowedZooms: [10],
    getCatalogAccess,
    getImageAccess: () => getImageAccess('nowcast'),
    freshnessPolicy: options.schedule.freshness.imageCatalog,
    fetchFn: options.fetchFn,
    clock: () => nowFn().toISOString() as UtcIso8601String,
  });

  const rawKikikuru = new KikikuruService(options.connection, {
    cacheRoot: kikikuruCacheRoot,
    allowedZooms: [10],
    getCatalogAccess,
    getImageAccess: () => getImageAccess('kikikuru'),
    freshnessPolicy: options.schedule.freshness.imageCatalog,
    fetchFn: options.fetchFn,
    clock: () => nowFn().toISOString() as UtcIso8601String,
  });

  const guardedNowcast = createClosedGuardProxy(rawNowcast, () => isClosed);
  const guardedKikikuru = createClosedGuardProxy(rawKikikuru, () => isClosed);

  return {
    nowcast: guardedNowcast,
    kikikuru: guardedKikikuru,
    close: async () => {
      isClosed = true;
      await Promise.all([rawNowcast.waitForIdle(), rawKikikuru.waitForIdle()]);
    },
  };
}
