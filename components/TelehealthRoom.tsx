"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, PhoneOff } from "lucide-react";

type JitsiApi = {
  executeCommand: (command: string, ...args: unknown[]) => void;
  addEventListener: (event: string, handler: (...args: unknown[]) => void) => void;
  dispose: () => void;
};

declare global {
  interface Window {
    JitsiMeetExternalAPI?: new (
      domain: string,
      options: Record<string, unknown>,
    ) => JitsiApi;
  }
}

const JITSI_SCRIPT_SRC = "https://meet.jit.si/external_api.js";

function roomNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\/+/, "").split("/")[0] || url;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/").pop() || "carepulse-room";
  }
}

export default function TelehealthRoom({
  roomUrl,
  audioOnly = false,
  onLeave,
  onJoined,
}: {
  roomUrl: string;
  audioOnly?: boolean;
  onLeave?: () => void;
  onJoined?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<JitsiApi | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(Boolean(audioOnly));
  const [isVideoOff, setIsVideoOff] = useState(Boolean(audioOnly));
  const [participantCount, setParticipantCount] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    const init = () => {
      if (cancelled || !container) return;

      const JitsiMeetExternalAPI = window.JitsiMeetExternalAPI;
      if (!JitsiMeetExternalAPI) {
        setError("Could not load the video service. Check your connection and try again.");
        setIsLoading(false);
        return;
      }

      try {
        const api = new JitsiMeetExternalAPI("meet.jit.si", {
          roomName: roomNameFromUrl(roomUrl),
          parentNode: container,
          width: "100%",
          height: "100%",
          configOverwrite: {
            startWithAudioMuted: Boolean(audioOnly),
            startWithVideoMuted: Boolean(audioOnly),
            prejoinPageEnabled: false,
            disableDeepLinking: true,
          },
          interfaceConfigOverwrite: {
            TOOLBAR_BUTTONS: [],
            SHOW_JITSI_WATERMARK: false,
            SHOW_WATERMARK_FOR_GUESTS: false,
          },
        });

        apiRef.current = api;

        api.addEventListener("videoConferenceJoined", () => {
          if (cancelled) return;
          setIsLoading(false);
          setError(null);
          onJoined?.();
        });

        api.addEventListener("participantJoined", () => {
          if (cancelled) return;
          setParticipantCount((count) => count + 1);
        });

        api.addEventListener("participantLeft", () => {
          if (cancelled) return;
          setParticipantCount((count) => Math.max(1, count - 1));
        });

        api.addEventListener("readyToClose", () => {
          if (cancelled) return;
          onLeave?.();
        });

        // Fallback in case the joined event is delayed.
        window.setTimeout(() => {
          if (!cancelled) {
            setIsLoading(false);
          }
        }, 8000);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to start the call. Please try again.",
        );
        setIsLoading(false);
      }
    };

    // Reuse an already-loaded script if present (Fast Refresh / remount).
    if (window.JitsiMeetExternalAPI) {
      init();
    } else {
      const existing = document.querySelector<HTMLScriptElement>(
        `script[src="${JITSI_SCRIPT_SRC}"]`,
      );
      const script = existing ?? document.createElement("script");
      if (!existing) {
        script.src = JITSI_SCRIPT_SRC;
        script.async = true;
        document.body.appendChild(script);
      }
      script.addEventListener("load", init, { once: true });
      script.addEventListener(
        "error",
        () => {
          if (cancelled) return;
          setError("Could not load the video service. Check your connection and try again.");
          setIsLoading(false);
        },
        { once: true },
      );
    }

    return () => {
      cancelled = true;
      if (apiRef.current) {
        try {
          apiRef.current.dispose();
        } catch {
          // ignore
        }
        apiRef.current = null;
      }
    };
  }, [roomUrl, audioOnly, onLeave, onJoined]);

  const toggleMute = () => {
    apiRef.current?.executeCommand("toggleAudio");
    setIsMuted((value) => !value);
  };

  const toggleVideo = () => {
    if (audioOnly) return;
    apiRef.current?.executeCommand("toggleVideo");
    setIsVideoOff((value) => !value);
  };

  const leaveCall = () => {
    apiRef.current?.executeCommand("hangup");
    onLeave?.();
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-xl bg-black">
      <div ref={containerRef} className="flex-1" />

      {isLoading ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-white">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            <p className="text-sm">Connecting…</p>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 px-6 text-center text-white">
          <p className="text-sm">{error}</p>
        </div>
      ) : null}

      {!error ? (
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-black/60 px-4 py-2 backdrop-blur">
          <button
            type="button"
            onClick={toggleMute}
            aria-label={isMuted ? "Unmute" : "Mute"}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>

          {!audioOnly ? (
            <button
              type="button"
              onClick={toggleVideo}
              aria-label={isVideoOff ? "Turn camera on" : "Turn camera off"}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20"
            >
              {isVideoOff ? (
                <VideoOff className="h-5 w-5" />
              ) : (
                <Video className="h-5 w-5" />
              )}
            </button>
          ) : null}

          <button
            type="button"
            onClick={leaveCall}
            aria-label="Leave call"
            className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-red-600 bg-red-600 text-white transition-colors hover:bg-red-700"
          >
            <PhoneOff className="h-5 w-5" />
          </button>

          <div className="w-[100px] text-right text-xs text-white/70">
            {participantCount} participant{participantCount === 1 ? "" : "s"}
          </div>
        </div>
      ) : null}
    </div>
  );
}
