"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Loader2, Phone, Send, Video, X } from "lucide-react";
import {
  callInviteKind,
  fetchDirectMessages,
  fetchMessages,
  markDirectMessagesRead,
  markMessagesRead,
  sendDirectMessage,
  sendMessage,
  type ChatMessage,
} from "@/lib/chat";

export function ChatModal({
  appointmentId,
  recipientId,
  otherPartyName,
  currentUserId,
  client,
  onClose,
  onStartVideoCall,
  onStartAudioCall,
}: {
  appointmentId?: string;
  recipientId?: string;
  otherPartyName: string;
  currentUserId: string;
  client: SupabaseClient;
  onClose: () => void;
  onStartVideoCall?: () => void;
  onStartAudioCall?: () => void;
}) {
  const direct = Boolean(recipientId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const list = direct
          ? await fetchDirectMessages(client, currentUserId, recipientId!)
          : await fetchMessages(client, appointmentId!);
        if (!active) return;
        setMessages(list);
        if (direct) {
          await markDirectMessagesRead(client, currentUserId, recipientId!);
        } else {
          await markMessagesRead(client, appointmentId!, currentUserId);
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load messages");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    const channelName = direct
      ? `direct:${currentUserId}:${recipientId}`
      : `chat:${appointmentId}`;
    const table = direct ? "direct_messages" : "appointment_messages";
    const filter = direct
      ? `recipient_id=eq.${currentUserId}`
      : `appointment_id=eq.${appointmentId}`;

    const channel = client
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table,
          filter,
        },
        (payload) => {
          if (!active) return;
          const row = payload.new as Record<string, unknown>;
          const id = String(row.id ?? "");
          const senderId = String(row.sender_id ?? "");
          const body = String(row.body ?? "");
          const createdAt = String(row.created_at ?? "");
          const readAt =
            typeof row.read_at === "string" ? row.read_at : null;

          if (!id || !body || !createdAt) return;

          // For direct threads, only care about messages in this conversation.
          if (direct) {
            const other = recipientId!;
            const involved =
              (senderId === currentUserId && String(row.recipient_id) === other) ||
              (senderId === other && String(row.recipient_id) === currentUserId);
            if (!involved) return;
          }

          const threadId = direct ? recipientId! : appointmentId!;

          setMessages((current) => {
            if (current.some((m) => m.id === id)) return current;
            return [
              ...current,
              {
                id,
                appointmentId: threadId,
                senderId,
                body,
                createdAt,
                readAt,
              },
            ];
          });

          if (senderId !== currentUserId) {
            if (direct) {
              void markDirectMessagesRead(client, currentUserId, senderId);
            } else {
              void markMessagesRead(client, appointmentId!, currentUserId);
            }
          }
        },
      )
      .subscribe();

    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [client, appointmentId, recipientId, currentUserId, direct]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      const message = direct
        ? await sendDirectMessage(
            client,
            currentUserId,
            recipientId!,
            draft,
          )
        : await sendMessage(client, appointmentId!, currentUserId, draft);
      setMessages((current) =>
        current.some((m) => m.id === message.id)
          ? current
          : [...current, message],
      );
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send message");
    } finally {
      setSending(false);
    }
  }

  const latestInviteIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (
        messages[i].senderId !== currentUserId &&
        callInviteKind(messages[i].body)
      ) {
        return i;
      }
    }
    return -1;
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="flex h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-black/10 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-black/45">
              Chat
            </p>
            <h2 className="text-lg font-semibold text-black">
              {otherPartyName}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {onStartAudioCall ? (
              <button
                type="button"
                onClick={onStartAudioCall}
                title="Start an audio call"
                aria-label="Start an audio call"
                className="inline-flex items-center justify-center rounded-lg border border-brand-hover p-2 text-black transition-colors hover:bg-brand-accent/15"
              >
                <Phone className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
            {onStartVideoCall ? (
              <button
                type="button"
                onClick={onStartVideoCall}
                title="Start a video call"
                aria-label="Start a video call"
                className="inline-flex items-center justify-center rounded-lg border border-brand-hover p-2 text-black transition-colors hover:bg-brand-accent/15"
              >
                <Video className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-black/10 p-2 text-black/60 transition-colors hover:border-brand-hover hover:text-black"
              aria-label="Close chat"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-brand-hover" />
            </div>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : messages.length === 0 ? (
            <p className="text-center text-sm text-black/50">
              No messages yet. Say hello!
            </p>
          ) : (
            messages.map((message, index) => {
              const mine = message.senderId === currentUserId;
              const invite = callInviteKind(message.body);
              // Only the newest invite from the other side offers a join button,
              // so old invites in the history don't look like live calls.
              const joinable =
                !mine && invite !== null && index === latestInviteIndex;
              const joinCall =
                invite === "audio" ? onStartAudioCall : onStartVideoCall;
              return (
                <div
                  key={message.id}
                  className={`flex ${mine ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                      mine
                        ? "bg-brand-accent text-black"
                        : invite && joinable
                          ? "border border-brand-hover bg-brand-accent/15 text-black"
                          : "bg-black/5 text-black"
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">
                      {message.body}
                    </p>
                    {joinable && joinCall ? (
                      <button
                        type="button"
                        onClick={joinCall}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-hover"
                      >
                        {invite === "audio" ? (
                          <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <Video className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        Join {invite} call
                      </button>
                    ) : null}
                    <p className="mt-1 text-[10px] opacity-60">
                      {new Date(message.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={handleSend}
          className="flex items-center gap-2 border-t border-black/10 px-5 py-3"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type a message…"
            className="flex-1 rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black focus:border-brand-hover focus:outline-none focus:ring-1 focus:ring-brand-hover"
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="inline-flex items-center justify-center rounded-lg bg-brand-accent p-2 text-black transition-colors hover:bg-brand-hover hover:text-white disabled:opacity-50"
            aria-label="Send message"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
