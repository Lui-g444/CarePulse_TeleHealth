"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Check, Clock } from "lucide-react";
import { formatTimeLabel, toDateKey } from "@/lib/booking";
import { statusLabel, type QueueStatus } from "@/lib/doctor";
import {
  fetchPublicQueue,
  fetchPublicQueueDoctors,
  formatQueueDay,
  type PublicQueueDoctor,
  type PublicQueueEntry,
} from "@/lib/public-queue";
import { createClient } from "@/lib/supabase";

/**
 * The landing page's "Appointment queue" card.
 *
 * Reads the masked `appointment_feed` table so anonymous visitors see the real,
 * current schedule (initials only) and keeps itself current over Supabase
 * realtime whenever a booking is created or a status changes.
 */

type LiveStatus = "connecting" | "live" | "offline";

const STATUS_STYLES: Record<QueueStatus, string> = {
  pending: "border-black/15 bg-white text-black/65",
  confirmed: "border-brand-hover/40 bg-brand-accent/25 text-black",
  completed: "border-brand-hover bg-brand-hover text-white",
  cancelled: "border-red-200 bg-red-50 text-red-700",
};

export function LiveAppointmentQueue() {
  const clientRef = useRef<SupabaseClient | null>(null);
  const [entries, setEntries] = useState<PublicQueueEntry[] | null>(null);
  const [doctors, setDoctors] = useState<Record<string, PublicQueueDoctor>>({});
  const [error, setError] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");
  // Read in the effect below rather than during render: the landing page is
  // prerendered, so the date has to be resolved on the client.
  const [todayKey, setTodayKey] = useState("");

  const refresh = useCallback(async () => {
    try {
      const supabase = clientRef.current ?? createClient();
      clientRef.current = supabase;

      const today = toDateKey(new Date());
      const [queue, directory] = await Promise.all([
        fetchPublicQueue(supabase, today),
        fetchPublicQueueDoctors(supabase),
      ]);

      setTodayKey(today);
      setEntries(queue);
      setDoctors(directory);
      setError(null);
    } catch (loadError) {
      // Keep the marketing page's copy friendly; the details stay in the console.
      console.warn(
        "[landing-queue] Could not load the public appointment feed:",
        loadError,
      );
      setError("Today's schedule is temporarily unavailable.");
      setEntries((current) => current ?? []);
      setLiveStatus("offline");
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
    })();
  }, [refresh]);

  // Any booking, cancellation or status change on the feed refetches the list,
  // so the card matches the database without a page reload.
  useEffect(() => {
    let active = true;
    let channel: ReturnType<SupabaseClient["channel"]> | null = null;

    (async () => {
      let supabase: SupabaseClient;

      try {
        supabase = clientRef.current ?? createClient();
        clientRef.current = supabase;
      } catch {
        return;
      }

      if (!active) {
        return;
      }

      channel = supabase
        .channel("landing-appointment-feed")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "appointment_feed",
          },
          () => {
            void refresh();
          },
        )
        .subscribe((status) => {
          if (!active) {
            return;
          }

          if (status === "SUBSCRIBED") {
            setLiveStatus("live");
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            setLiveStatus("offline");
          }
        });
    })();

    return () => {
      active = false;

      if (channel) {
        void clientRef.current?.removeChannel(channel);
      }
    };
  }, [refresh]);

  return (
    <div className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-black/45">
            Today &amp; upcoming
          </p>
          <p className="text-base font-semibold">Appointment queue</p>
        </div>
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-black/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-black/55"
          title={
            liveStatus === "live"
              ? "Realtime updates connected"
              : liveStatus === "offline"
                ? "Realtime updates unavailable"
                : "Connecting to realtime updates"
          }
        >
          <span
            className={clsx(
              "h-1.5 w-1.5 rounded-full",
              liveStatus === "live"
                ? "animate-pulse bg-brand-hover"
                : liveStatus === "offline"
                  ? "bg-red-500"
                  : "bg-amber-500",
            )}
          />
          {liveStatus === "live"
            ? "Live"
            : liveStatus === "offline"
              ? "Offline"
              : "Connecting"}
        </span>
      </div>

      <div className="mt-4">
        {error ? (
          <p className="rounded-xl border border-dashed border-black/15 p-5 text-center text-xs text-black/55">
            {error}
          </p>
        ) : entries === null ? (
          <div className="space-y-3">
            {[0, 1, 2].map((key) => (
              <div
                key={key}
                className="h-[68px] animate-pulse rounded-xl border border-black/10 bg-black/5"
              />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <p className="rounded-xl border border-dashed border-black/15 p-5 text-center text-xs text-black/55">
            No visits on the books yet — the first booking appears here.
          </p>
        ) : (
          <ul className="space-y-3">
            {entries.map((entry) => {
              const doctor = doctors[entry.doctorId];

              return (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-black/10 p-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-bg text-xs font-semibold">
                      {entry.initials || "PT"}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        Patient{entry.initials ? ` ${entry.initials}` : ""}
                      </p>
                      <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-black/50">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" aria-hidden="true" />
                          {formatTimeLabel(entry.time)}
                        </span>
                        {entry.date !== todayKey ? (
                          <span>{formatQueueDay(entry.date, todayKey)}</span>
                        ) : null}
                        {doctor?.fullName ? (
                          <span className="truncate">{doctor.fullName}</span>
                        ) : null}
                      </p>
                    </div>
                  </div>
                  <span
                    className={clsx(
                      "shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide",
                      STATUS_STYLES[entry.status],
                    )}
                  >
                    {statusLabel(entry.status)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-xl bg-primary-bg p-3 text-xs text-black/60">
        <Check className="h-4 w-4 shrink-0 text-brand-hover" aria-hidden="true" />
        Live schedule — patient names stay private.
      </div>
    </div>
  );
}
