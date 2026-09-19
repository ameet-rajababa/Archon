import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import { LoginPage } from '@/routes/LoginPage';
import { ConsoleApp } from '@/experiments/console/ConsoleApp';
import { SessionGate } from '@/components/auth/SessionGate';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught rendering error', {
      error: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen items-center justify-center bg-zinc-950 p-8">
          <div className="max-w-md text-center">
            <h1 className="mb-2 text-xl font-semibold text-zinc-100">Something went wrong</h1>
            <p className="mb-4 text-sm text-zinc-400">
              {this.state.error?.message ?? 'An unexpected error occurred.'}
            </p>
            <button
              onClick={(): void => {
                window.location.reload();
              }}
              className="rounded-md bg-zinc-800 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-700"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App(): React.ReactElement {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            {/* Login mounts OUTSIDE the SessionGate so it is always reachable. */}
            <Route path="/login" element={<LoginPage />} />
            {/* The console is the only UI. */}
            <Route path="/" element={<Navigate to="/console" replace />} />
            {/*
              Console mounts INSIDE SessionGate — otherwise /console would bypass
              web auth. When web auth is disabled (the solo default) SessionGate
              passes children through unchanged after a brief auth-status check
              (cached for the session) — no login required.
            */}
            <Route
              path="/console/*"
              element={
                <SessionGate>
                  <ConsoleApp />
                </SessionGate>
              }
            />
            {/*
              The classic UI is retired. Its source still sits in routes/ and
              components/ so upstream commits to those files keep merging
              cleanly, but nothing imports it, so Rollup drops it from the
              bundle. Old /legacy bookmarks land on the console.
            */}
            <Route path="/legacy/*" element={<Navigate to="/console" replace />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
