"use client";

import { Loader2, X } from "lucide-react";
import TelehealthRoom from "@/components/TelehealthRoom";

/**
 * Full-screen overlay for an audio or video consultation. `roomUrl` is null
 * while the server is creating the Daily room.
 */
export function CallModal({
  title,
  subtitle,
  audioOnly,
  roomUrl,
  loading,
  error,
  onClose,
}: {
  title: string;
  subtitle: string;
  audioOnly: boolean;
  roomUrl: string | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
      <div className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-black/10 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-black/45">
              {subtitle}
            </p>
            <h2 className="text-lg font-semibold text-black">
              {audioOnly ? "Audio call with " : "Video call with "}
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-black/10 p-2 text-black/60 transition-colors hover:border-brand-hover hover:text-black"
            aria-label="Close call"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 p-4">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-brand-hover" />
            </div>
          ) : null}
          {!loading && error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-sm text-red-600">{error}</p>
              <p className="text-xs text-black/50">
                Allow camera and microphone access in your browser, then try
                again.
              </p>
            </div>
          ) : null}
          {roomUrl ? (
            <TelehealthRoom
              roomUrl={roomUrl}
              audioOnly={audioOnly}
              onLeave={onClose}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
