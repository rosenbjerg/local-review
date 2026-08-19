import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// The one class component in the app: React offers no hook equivalent for error
// boundaries. Without it a render-time throw unmounts the whole tree and leaves a
// blank page with nothing to act on — and since the repo selection is remembered in
// localStorage, a crash tied to that selection would repeat on every reload. Showing
// the message plus a way out turns any such bug into something reportable.
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
          {/* The remembered repo/branch selection is the most likely thing a crash
              is tied to, so offer the reset that a reload alone won't do. */}
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
