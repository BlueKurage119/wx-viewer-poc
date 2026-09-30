import type { ReactNode } from 'react';
import {
  createTerminalRegistry,
  createVenueRegistry,
  isTerminalConfigResponse,
  type TerminalRegistry,
  type VenueConfigResponse,
  type VenueForecastTargets,
} from '@wx-viewer-poc/shared';
import { createTerminals } from './shell/config';
import { setCurrentVenueRegistry } from './venueRegistryContext';

interface RootRenderer {
  render(children: ReactNode): void;
}

export interface EntryBootstrapDependencies {
  readonly createRoot: (container: Element) => RootRenderer;
  readonly fetch?: typeof fetch;
  readonly renderApplication: (
    registry: ReturnType<typeof createVenueRegistry>,
    terminalRegistry: TerminalRegistry,
  ) => ReactNode;
}

export function createEntryBootstrap(
  appRoot: Element,
  dependencies: EntryBootstrapDependencies,
): () => Promise<void> {
  // 起動中に一度だけ生成し、以後の状態表示でも再利用する。
  const root = dependencies.createRoot(appRoot);

  function render(message: string, retry = false) {
    root.render(
      <main className="entry-message">
        <h1>{message}</h1>
        {retry ? <button onClick={() => void bootstrap()}>再試行</button> : null}
      </main>,
    );
  }

  async function bootstrap() {
    render('設定を読み込んでいます');
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response;
      try {
        response = await (dependencies.fetch ?? fetch)('/api/config/venues', { cache: 'no-store' });
      } catch {
        render('会場設定の通信に失敗しました', true);
        return;
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        render('会場設定の応答が不正です');
        return;
      }
      if (!response.ok) {
        render('会場設定の取得に失敗しました', true);
        return;
      }
      if (!isVenueConfigResponse(body)) {
        render('会場設定の応答が不正です');
        return;
      }
      let terminalResponse: Response;
      try {
        terminalResponse = await (dependencies.fetch ?? fetch)('/api/config/terminals', {
          cache: 'no-store',
        });
      } catch {
        render('端末設定の通信に失敗しました', true);
        return;
      }
      if (!terminalResponse.ok) {
        render('端末設定の取得に失敗しました', true);
        return;
      }
      let terminalBody: unknown;
      try {
        terminalBody = await terminalResponse.json();
      } catch {
        render('端末設定の応答が不正です');
        return;
      }
      if (!isTerminalConfigResponse(terminalBody)) {
        render('端末設定の応答が不正です');
        return;
      }
      if (terminalBody.venueGeneration !== body.generation) continue;
      try {
        const registry = createVenueRegistry(
          body.venues as readonly VenueForecastTargets[],
          body.generation,
        );
        if (terminalBody.terminals.some((terminal) => !registry.resolveVenueId(terminal.venueId))) {
          render('端末設定の会場が不正です');
          return;
        }
        const terminalRegistry = createTerminalRegistry(
          terminalBody.terminals,
          terminalBody.generation,
        );
        createTerminals(registry, terminalRegistry);
        setCurrentVenueRegistry(registry);
        root.render(dependencies.renderApplication(registry, terminalRegistry));
        return;
      } catch {
        render('設定の応答が不正です');
        return;
      }
    }
    render('設定の世代が一致しません', true);
  }

  return bootstrap;
}

function isVenueConfigResponse(value: unknown): value is VenueConfigResponse {
  if (value === null || typeof value !== 'object') return false;
  const config = value as { generation?: unknown; venues?: unknown };
  return (
    typeof config.generation === 'string' &&
    Array.isArray(config.venues) &&
    config.venues.every(isVenueConfig)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isVenueConfig(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const mapReference = value.mapReference;
  const warning = value.warning;
  const warningTimeseries = value.warningTimeseries;
  const broadForecast = value.broadForecast;
  const temperatureForecast = value.temperatureForecast;
  const amedas = value.amedas;
  const bosaiBulletin = value.bosaiBulletin;
  return (
    typeof value.venueId === 'string' &&
    typeof value.venueName === 'string' &&
    typeof value.experimental === 'boolean' &&
    isRecord(mapReference) &&
    typeof mapReference.latitude === 'number' &&
    typeof mapReference.longitude === 'number' &&
    isRecord(warning) &&
    typeof warning.municipalCode === 'string' &&
    typeof warning.displayName === 'string' &&
    typeof warning.prefectureCode === 'string' &&
    isRecord(warningTimeseries) &&
    typeof warningTimeseries.municipalCode === 'string' &&
    typeof warningTimeseries.displayName === 'string' &&
    isRecord(broadForecast) &&
    typeof broadForecast.areaCode === 'string' &&
    typeof broadForecast.displayName === 'string' &&
    isRecord(temperatureForecast) &&
    typeof temperatureForecast.stationCode === 'string' &&
    typeof temperatureForecast.displayName === 'string' &&
    isRecord(amedas) &&
    typeof amedas.stationCode === 'string' &&
    typeof amedas.displayName === 'string' &&
    typeof amedas.elements === 'string' &&
    isRecord(bosaiBulletin) &&
    Array.isArray(bosaiBulletin.includedAreaCodes) &&
    bosaiBulletin.includedAreaCodes.every((code) => typeof code === 'string')
  );
}
