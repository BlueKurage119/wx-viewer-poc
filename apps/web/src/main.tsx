import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ThemeProvider } from './theme';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('#root element not found');
}
const appRoot = rootElement;

async function bootstrap() {
  if (typeof document.createTreeWalker === 'function') {
    await import('@material/web/labs/gb/components/button/md-gb-button.js');
  }

  createRoot(appRoot).render(
    <StrictMode>
      <ThemeProvider fixedMode="dark">
        <App />
      </ThemeProvider>
    </StrictMode>,
  );
}

void bootstrap();
