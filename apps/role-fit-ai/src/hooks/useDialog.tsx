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
  useRef,
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

export function DialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState>(null);
  // The resolver is stored in a ref so it persists across renders without
  // being part of the state that triggers re-renders.
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setDialog({ kind: "confirm", opts });
    });
  }, []);

  const alert = useCallback((opts: AlertOptions): Promise<void> => {
    return new Promise<void>((resolve) => {
      // Alert resolves void; we wrap a boolean resolver and discard the value.
      resolverRef.current = () => resolve();
      setDialog({ kind: "alert", opts });
    });
  }, []);

  function handleConfirm() {
    resolverRef.current?.(true);
    resolverRef.current = null;
    setDialog(null);
  }

  function handleCancel() {
    resolverRef.current?.(false);
    resolverRef.current = null;
    setDialog(null);
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
