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

function bootstrap() {
  createRoot(appRoot).render(
    <StrictMode>
      <ThemeProvider fixedMode="dark">
        <App />
      </ThemeProvider>
    </StrictMode>,
  );
}

void bootstrap();
