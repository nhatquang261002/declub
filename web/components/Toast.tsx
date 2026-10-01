"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { describeError, type AppError } from "@/lib/errors";
import { Alert, toneOf, type AlertTone } from "./Alert";

type ToastInput = {
  tone: AlertTone;
  title: string;
  message?: string;
  details?: string;
  actions?: ReactNode;
  /** Milliseconds on screen; 0 keeps it until dismissed. */
  duration?: number;
};

type ToastItem = ToastInput & { id: string; seq: number };

type ToastApi = {
  show: (toast: ToastInput) => void;
  /** Toasts anything thrown (or an already-described error); a rejected prompt gets a quieter tone. */
  error: (error: unknown, extra?: { actions?: ReactNode }) => void;
  dismiss: (id: string) => void;
};

const MAX_VISIBLE = 4;
// Errors stay long enough to read and act on; a cancelled prompt needs no study.
const DURATION: Record<AlertTone, number> = { danger: 10_000, warn: 6_000, info: 6_000, success: 5_000 };

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>.");
  return api;
}

function isAppError(value: unknown): value is AppError {
  return typeof value === "object" && value !== null && "kind" in value && "title" in value && "message" in value;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const show = useCallback((input: ToastInput) => {
    // The same failure twice in a row is one toast that starts over, not a growing stack.
    const id = `${input.tone}|${input.title}|${input.message ?? ""}`;
    setToasts((all) => [
      ...all.filter((t) => t.id !== id).slice(-(MAX_VISIBLE - 1)),
      { ...input, id, seq: Date.now() + Math.random() },
    ]);
  }, []);

  const error = useCallback(
    (cause: unknown, extra?: { actions?: ReactNode }) => {
      const described = isAppError(cause) ? cause : describeError(cause);
      show({
        tone: toneOf(described),
        title: described.title,
        message: described.message,
        details: described.details,
        actions: extra?.actions,
      });
    },
    [show],
  );

  const api = useMemo<ToastApi>(() => ({ show, error, dismiss }), [show, error, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" role="region" aria-label="Notifications">
        {toasts.map((toast) => (
          <ToastCard key={toast.seq} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  // Hovering or focusing a toast holds it, so details can be read and copied.
  const [held, setHeld] = useState(false);
  const duration = toast.duration ?? DURATION[toast.tone];

  useEffect(() => {
    if (held || duration === 0) return;
    const timer = setTimeout(() => onDismiss(toast.id), duration);
    return () => clearTimeout(timer);
  }, [held, duration, toast.id, onDismiss]);

  return (
    <div
      className="toast"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <Alert
        tone={toast.tone}
        title={toast.title}
        details={toast.details}
        actions={toast.actions}
        onDismiss={() => onDismiss(toast.id)}
      >
        {toast.message}
      </Alert>
    </div>
  );
}
