import type { PropsWithChildren } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { Button } from '../components/ui';

export function AppErrorBoundary({ children }: PropsWithChildren) {
  return (
    <ErrorBoundary fallbackRender={({ error, resetErrorBoundary }) => (
      <main>
        <h1>Knowra V4</h1>
        <section aria-labelledby="fatal-error-title">
          <h2 id="fatal-error-title">应用发生意外错误</h2>
          <p role="alert">{error instanceof Error ? error.message : '未知错误'}</p>
          <Button onPress={resetErrorBoundary}>重新加载界面</Button>
        </section>
      </main>
    )}>
      {children}
    </ErrorBoundary>
  );
}
