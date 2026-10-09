import type { TerminalDefinition, VenueForecastTargets } from '@wx-viewer-poc/shared';
import type { PollingScheduleConfig } from '../config/pollingSchedule.js';
import type { AcquisitionReport } from './createAcquisitionRuntime.js';
import type { WeatherEpoch, WeatherOperations } from './weatherContracts.js';

export interface DeliverySettings {
  readonly venues: readonly VenueForecastTargets[];
  readonly venueGeneration: string;
  readonly terminals: readonly TerminalDefinition[];
  readonly terminalGeneration: string;
  readonly schedule: PollingScheduleConfig;
  readonly enablePolling: boolean;
  readonly serverStartedAt: string;
  readonly nowcastCacheRoot: string;
  readonly kikikuruCacheRoot: string;
}

export interface DeliveryConnectionSpec {
  readonly generation: string;
  readonly schemaVersion: number;
  readonly acquisitionEpoch: WeatherEpoch;
  readonly readerEpoch: string;
}

export interface DeliveryReadContext {
  readonly now?: string;
  readonly report: AcquisitionReport | null;
  readonly unknownScopes: readonly string[];
  readonly validatedScopes: readonly string[];
}

export interface DeliveryReadInput<K extends keyof WeatherOperations = keyof WeatherOperations> {
  readonly requestId: string;
  readonly epoch: WeatherEpoch;
  readonly deadlineAt: string;
  readonly kind: K;
  readonly payload: WeatherOperations[K]['request'];
  readonly context: DeliveryReadContext;
}

export interface DeliveryHttpResult {
  readonly statusCode: number;
  readonly contentType: 'application/json; charset=utf-8' | 'image/png';
  readonly bytes: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
  /** メインでHTTP送信が終わったときに容量予約を返す。Workerとの通信には含めない。 */
  readonly release?: () => void;
}
