import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let errorMessage = this.state.error?.message || 'An unexpected error occurred.';
      let isFirestoreError = false;
      
      try {
        const parsed = JSON.parse(errorMessage);
        if (parsed && parsed.error && parsed.operationType) {
          isFirestoreError = true;
          errorMessage = `Firestore Error (${parsed.operationType}): ${parsed.error}`;
          if (parsed.path) {
            errorMessage += ` at path: ${parsed.path}`;
          }
        }
      } catch (e) {
        // Not a JSON error message
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="bg-white p-8 rounded-xl shadow-sm border border-red-100 max-w-md w-full text-center space-y-4">
            <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-red-600" />
            </div>
            <h2 className="text-xl font-semibold text-slate-900">Something went wrong</h2>
            <p className="text-sm text-slate-600">
              {isFirestoreError 
                ? "There was a problem communicating with the database. You might not have the right permissions."
                : "The application encountered an unexpected error."}
            </p>
            <div className="bg-slate-100 p-3 rounded text-left overflow-auto max-h-40 text-xs font-mono text-slate-800">
              {errorMessage}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="w-full h-10 bg-indigo-600 text-white rounded-md font-medium hover:bg-indigo-700 transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}
