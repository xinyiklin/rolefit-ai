import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DialogProvider } from "./hooks/useDialog";
import {
  adoptWorkspacePreferences,
  startWorkspacePreferencesRefresh
} from "./lib/workspacePreferencesSync";
import "./styles/index.css";

// Minimal error boundary: catches render-time throws so the whole app doesn't
// go blank. Shows a calm recovery message (no stack traces, no resume text).
// A successfully written autosave survives a crash and is offered for recovery
// on reload. The recovery copy stays conditional because writes are debounced
// and browser storage can be unavailable.
class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  handleReload() {
    window.location.reload();
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-error" role="alert">
          <p className="app-error__title">Something went wrong. RoleFit AI hit an unexpected error.</p>
          <p className="app-error__body">
            Reload to continue. If a recent autosave exists, RoleFit AI will offer it after reload.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="secondary-button is-compact app-error__reload"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Adopt canonical workspace preferences before the app's own state (which
// reads the browser cache on mount) ever renders. Bound
// to ~1.5s and fail-open internally (see workspacePreferencesSync.ts), so a slow or
// unreachable server delays first paint only briefly and never blocks it.
await adoptWorkspacePreferences();
startWorkspacePreferencesRefresh();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <DialogProvider>
        <App />
      </DialogProvider>
    </AppErrorBoundary>
  </React.StrictMode>
);
