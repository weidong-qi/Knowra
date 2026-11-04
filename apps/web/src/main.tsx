import { installDesktopLifecycle } from './app/desktopLifecycle';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, AppRoot } from './app/App';
import { AppErrorBoundary } from './app/AppErrorBoundary';
import { AppProviders } from './app/AppProviders';
import { RouterProvider, useHashLocation } from './app/router';
import './styles/tokens.css';
import './styles/reset.css';
import './styles/global.css';

installDesktopLifecycle();

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('V4 root element is missing.');
}

function Root() {
  const location = useHashLocation();
  return (
    <RouterProvider location={location}>
      <App />
    </RouterProvider>
  );
}

createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary>
      <AppProviders>
        <Root />
      </AppProviders>
    </AppErrorBoundary>
  </StrictMode>
);

export { AppRoot };
