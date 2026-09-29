import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  configureVenueRegistry,
  createVenueRegistry,
  type VenueConfigResponse,
  type VenueForecastTargets,
} from '@wx-viewer-poc/shared';
import { App } from './App';
import { ThemeProvider } from './theme';
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
    config.venues.every(
      (venue) =>
        venue !== null &&
        typeof venue === 'object' &&
        typeof (venue as { venueId?: unknown }).venueId === 'string' &&
        typeof (venue as { venueName?: unknown }).venueName === 'string' &&
        typeof (venue as { experimental?: unknown }).experimental === 'boolean',
    )
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
  configureVenueRegistry(
    createVenueRegistry(body.venues as readonly VenueForecastTargets[], body.generation),
  );
  createRoot(appRoot).render(
    <StrictMode>
      <ThemeProvider fixedMode="dark">
        <App />
      </ThemeProvider>
    </StrictMode>,
  );
}

void bootstrap();
