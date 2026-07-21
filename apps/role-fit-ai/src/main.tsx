import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DialogProvider } from "./hooks/useDialog";
import { migrateLegacyDocStylePrefs } from "./lib/docStyleMigration";
import { adoptWorkspacePreferences } from "./lib/browserPrefsSync";
import "./styles/index.css";

// One-shot, idempotent: carries a returning user's pre-monorepo docStyle/
// editorPrefs localStorage keys over to the shared useDocStyle hook's keys
// before it ever reads them. See src/lib/docStyleMigration.ts.
migrateLegacyDocStylePrefs();

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

// Adopt any workspace-mirrored/restored browser preferences before the app's
// own state (which reads settings/lastBaseResume on mount) ever renders. Bound
// to ~1.5s and fail-open internally (see browserPrefsSync.ts), so a slow or
// unreachable server delays first paint only briefly and never blocks it.
await adoptWorkspacePreferences();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <DialogProvider>
        <App />
      </DialogProvider>
    </AppErrorBoundary>
  </React.StrictMode>
);
