/**
 * useDialog — app-styled promise-based confirm / alert system.
 *
 * DialogProvider holds the active dialog state and a pending resolver ref.
 * The hook returns `confirm` and `alert` functions that set state and return
 * a Promise whose resolver is stored in the ref; the ConfirmDialog component
 * calls the resolver when the user acts.
 *
 * A React portal renders the dialog to document.body so it stacks above
 * .workspace-grid regardless of the call site's DOM position.
 */
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { ConfirmDialog } from "../sections/ConfirmDialog";

// -------- Public types --------

export type DialogTone = "default" | "danger";

export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
};

export type AlertOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
};

// -------- Internal dialog state --------

type DialogState =
  | { kind: "confirm"; opts: ConfirmOptions }
  | { kind: "alert"; opts: AlertOptions }
  | null;

// -------- Context --------

type DialogContextValue = {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  alert: (opts: AlertOptions) => Promise<void>;
};

const DialogContext = createContext<DialogContextValue | null>(null);

// -------- Provider --------

type PendingDialog = {
  state: NonNullable<DialogState>;
  resolver: (value: boolean) => void;
};

export function DialogProvider({ children }: { children: ReactNode }) {
  // FIFO queue, one dialog visible at a time. A single resolver slot would let
  // a second confirm()/alert() raised while one is open (e.g. the post-distill
  // duplicate gate firing ~30s after click) replace the visible dialog and
  // strand the first caller's promise forever — its awaiting workflow would
  // silently never continue.
  const [queue, setQueue] = useState<PendingDialog[]>([]);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setQueue((current) => [...current, { state: { kind: "confirm", opts }, resolver: resolve }]);
    });
  }, []);

  const alert = useCallback((opts: AlertOptions): Promise<void> => {
    return new Promise<void>((resolve) => {
      // Alert resolves void; we wrap a boolean resolver and discard the value.
      setQueue((current) => [...current, { state: { kind: "alert", opts }, resolver: () => resolve() }]);
    });
  }, []);

  const dialog = queue[0]?.state ?? null;

  function settleCurrent(value: boolean) {
    const head = queue[0];
    if (!head) return;
    head.resolver(value);
    setQueue((current) => (current[0] === head ? current.slice(1) : current));
  }

  function handleConfirm() {
    settleCurrent(true);
  }

  function handleCancel() {
    settleCurrent(false);
  }

  return (
    <DialogContext.Provider value={{ confirm, alert }}>
      {children}
      {dialog !== null &&
        createPortal(
          <ConfirmDialog
            kind={dialog.kind}
            title={dialog.opts.title}
            message={dialog.opts.message}
            confirmLabel={
              dialog.kind === "confirm"
                ? (dialog.opts.confirmLabel ?? "Confirm")
                : (dialog.opts.confirmLabel ?? "OK")
            }
            cancelLabel={dialog.kind === "confirm" ? (dialog.opts.cancelLabel ?? "Cancel") : undefined}
            tone={dialog.kind === "confirm" ? (dialog.opts.tone ?? "default") : "default"}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
          />,
          document.body
        )}
    </DialogContext.Provider>
  );
}

// -------- Hook --------

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error("useDialog must be used within a DialogProvider");
  }
  return ctx;
}
