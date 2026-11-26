import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorId: string | null;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorId: null, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    const errorId = `ERR-${Date.now().toString(36).toUpperCase()}`;
    return {
      hasError: true,
      errorId,
      message: error?.message || 'Unexpected rendering error',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary ${this.state.errorId}]`, error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
          <div className="w-full max-w-md rounded-2xl border border-rose-500/40 bg-slate-900 p-6 shadow-2xl space-y-4 text-center">
            <h1 className="text-lg font-bold text-white">Something went wrong — Reload</h1>
            <p className="text-xs text-slate-400">
              An unexpected error occurred while rendering this view.
            </p>
            <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 font-mono-num text-xs text-rose-300">
              Error ID: {this.state.errorId}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 text-xs font-semibold text-white cursor-pointer"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
