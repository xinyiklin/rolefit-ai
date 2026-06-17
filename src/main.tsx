import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DialogProvider } from "./hooks/useDialog";
import "./styles/index.css";

// Minimal error boundary: catches render-time throws so the whole app doesn't
// go blank. Shows a calm recovery message (no stack traces, no resume text).
// The autosaved draft (rolefit:draftAutosave) survives the crash in
// localStorage and is offered for recovery on reload.
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
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            gap: "12px",
            fontFamily: "system-ui, sans-serif",
            color: "oklch(0.25 0.012 160)",
            background: "oklch(0.956 0.006 150)",
            padding: "32px",
            textAlign: "center"
          }}
        >
          <p style={{ margin: 0, fontWeight: 600, fontSize: "1rem" }}>
            Something went wrong — the app encountered an unexpected error.
          </p>
          <p style={{ margin: 0, fontSize: "0.88rem", color: "oklch(0.5 0.014 160)" }}>
            Any unsaved draft was autosaved and can be recovered after reload.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              marginTop: "8px",
              padding: "6px 18px",
              border: "1px solid oklch(0.81 0.01 150)",
              borderRadius: "6px",
              background: "oklch(0.997 0.001 150)",
              color: "oklch(0.25 0.012 160)",
              cursor: "pointer",
              fontSize: "0.88rem"
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <DialogProvider>
        <App />
      </DialogProvider>
    </AppErrorBoundary>
  </React.StrictMode>
);
