"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import clsx from "clsx";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Visual tone of the confirm button. */
  tone?: "default" | "danger";
  /** When true, the confirm button shows a spinner and disables both buttons. */
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

/**
 * A small, accessible confirmation dialog. Replaces `window.confirm` so the
 * styling matches the rest of CarePulse and the action can be awaited.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy && !loading) {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    confirmRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, busy, loading, onCancel]);

  if (!open) {
    return null;
  }

  const isBusy = busy || loading;

  async function handleConfirm() {
    if (isBusy) {
      return;
    }

    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isBusy) {
          onCancel();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-md overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-black/10 px-5 py-4">
          <div className="flex items-start gap-3">
            <span
              className={clsx(
                "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                tone === "danger"
                  ? "bg-red-50 text-red-600"
                  : "bg-brand-accent/20 text-brand-hover",
              )}
            >
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </span>
            <h2
              id="confirm-dialog-title"
              className="text-base font-semibold text-black"
            >
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isBusy}
            aria-label="Close dialog"
            className="rounded-lg p-1.5 text-black/40 transition-colors hover:bg-black/5 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        {description ? (
          <div className="px-5 py-4 text-sm text-black/65">{description}</div>
        ) : null}

        {children ? <div className="px-5 pb-4">{children}</div> : null}

        <footer className="flex flex-col-reverse gap-2 border-t border-black/10 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isBusy}
            className="rounded-lg border border-black/15 px-4 py-2.5 text-sm font-semibold text-black/70 transition-colors hover:border-brand-hover hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => void handleConfirm()}
            disabled={isBusy}
            className={clsx(
              "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              tone === "danger"
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-brand-accent text-black hover:bg-brand-hover hover:text-white",
            )}
          >
            {isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}