import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createVenueRegistry,
  type VenueConfigResponse,
  type VenueForecastTargets,
} from '@wx-viewer-poc/shared';
import { App } from './App';
import { createTerminals } from './shell/config';
import { ThemeProvider } from './theme';
import { VenueRegistryProvider } from './venueConfig';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('#root element not found');
}
const appRoot = rootElement;

function render(message: string, retry = false) {
  createRoot(appRoot).render(
    <main className="entry-message">
      <h1>{message}</h1>
      {retry ? <button onClick={() => void bootstrap()}>再試行</button> : null}
    </main>,
  );
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
async function bootstrap() {
  render('会場設定を読み込んでいます');
  let response: Response;
  try {
    response = await fetch('/api/config/venues', { cache: 'no-store' });
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
  let registry: ReturnType<typeof createVenueRegistry>;
  try {
    registry = createVenueRegistry(body.venues as readonly VenueForecastTargets[], body.generation);
    createTerminals(registry);
  } catch {
    render('会場設定の応答が不正です');
    return;
  }
  createRoot(appRoot).render(
    <StrictMode>
      <ThemeProvider fixedMode="dark">
        <VenueRegistryProvider value={registry}>
          <App />
        </VenueRegistryProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}

void bootstrap();
