import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// The one class component: React has no hook for error boundaries, and without one a throw leaves a blank page.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("local-review crashed:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="empty crash" role="alert">
        <h2>local-review hit an unexpected error</h2>
        <pre className="crash-detail">{error.message}</pre>
        <div className="crash-actions">
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
          {/* The remembered selection is the likeliest thing a crash is tied to, and a reload won't undo it. */}
          <button
            className="btn"
            onClick={() => {
              for (const k of Object.keys(localStorage)) {
                if (k.startsWith("lr.")) localStorage.removeItem(k);
              }
              window.location.reload();
            }}
          >
            Clear saved settings and reload
          </button>
        </div>
      </div>
    );
  }
}
