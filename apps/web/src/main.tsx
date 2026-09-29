import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createEntryBootstrap } from './entryBootstrap';
import { ThemeProvider } from './theme';
import { VenueRegistryProvider } from './venueConfig';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('#root element not found');
}
void createEntryBootstrap(rootElement, {
  createRoot,
  renderApplication: (registry) => (
    <StrictMode>
      <ThemeProvider fixedMode="dark">
        <VenueRegistryProvider value={registry}>
          <App />
        </VenueRegistryProvider>
      </ThemeProvider>
    </StrictMode>
  ),
})();
