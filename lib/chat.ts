import type { SupabaseClient } from "@supabase/supabase-js";

export type ChatMessage = {
  id: string;
  appointmentId: string;
  senderId: string;
  body: string;
  createdAt: string;
  readAt: string | null;
};

export type CallInviteKind = "video" | "audio";

/** Chat lines posted when someone starts a consultation call. */
export const CALL_INVITE_BODY: Record<CallInviteKind, string> = {
  video: "I'm calling you now for a video consultation.",
  audio: "I'm calling you now for an audio consultation.",
};

/** Recognises a call invite so the chat can offer a join button. */
export function callInviteKind(body: string): CallInviteKind | null {
  const normalized = body.replace(/\u2019/g, "'").trim();

  if (normalized === CALL_INVITE_BODY.video) return "video";
  if (normalized === CALL_INVITE_BODY.audio) return "audio";

  return null;
}

type Row = Record<string, unknown>;

function rowsOf(data: unknown): Row[] {
  return Array.isArray(data) ? (data as Row[]) : [];
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toMessage(row: Row): ChatMessage | null {
  const id = readText(row.id);
  const appointmentId = readText(row.appointment_id);
  const senderId = readText(row.sender_id);
  const body = readText(row.body);
  const createdAt = readText(row.created_at);

  if (!id || !appointmentId || !senderId || !body || !createdAt) {
    return null;
  }

  return {
    id,
    appointmentId,
    senderId,
    body,
    createdAt,
    readAt: typeof row.read_at === "string" ? row.read_at : null,
  };
}

export async function fetchMessages(
  supabase: SupabaseClient,
  appointmentId: string,
): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("appointment_messages")
    .select("id, appointment_id, sender_id, body, created_at, read_at")
    .eq("appointment_id", appointmentId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return rowsOf(data)
    .map(toMessage)
    .filter((message): message is ChatMessage => message !== null);
}

export async function sendMessage(
  supabase: SupabaseClient,
  appointmentId: string,
  senderId: string,
  body: string,
): Promise<ChatMessage> {
  const trimmed = body.trim();

  if (!trimmed) {
    throw new Error("Message cannot be empty.");
  }

  const { data, error } = await supabase
    .from("appointment_messages")
    .insert({
      appointment_id: appointmentId,
      sender_id: senderId,
      body: trimmed,
    })
    .select("id, appointment_id, sender_id, body, created_at, read_at")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not send message.");
  }

  const message = toMessage(data as Row);

  if (!message) {
    throw new Error("Could not parse sent message.");
  }

  return message;
}

export async function markMessagesRead(
  supabase: SupabaseClient,
  appointmentId: string,
  readerId: string,
): Promise<void> {
  await supabase
    .from("appointment_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("appointment_id", appointmentId)
    .neq("sender_id", readerId)
    .is("read_at", null);
}

export async function fetchUnreadCountsByAppointment(
  supabase: SupabaseClient,
  userId: string,
  appointmentIds: string[],
): Promise<Record<string, number>> {
  if (appointmentIds.length === 0) {
    return {};
  }

  const { data, error } = await supabase
    .from("appointment_messages")
    .select("appointment_id")
    .in("appointment_id", appointmentIds)
    .neq("sender_id", userId)
    .is("read_at", null);

  if (error) {
    return {};
  }

  const counts: Record<string, number> = {};
  for (const row of rowsOf(data)) {
    const id = readText(row.appointment_id);
    if (id) {
      counts[id] = (counts[id] ?? 0) + 1;
    }
  }
  return counts;
}

export async function fetchTotalUnreadCount(
  supabase: SupabaseClient,
  userId: string,
  appointmentIds: string[],
): Promise<number> {
  const counts = await fetchUnreadCountsByAppointment(
    supabase,
    userId,
    appointmentIds,
  );
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

// ---------------------------------------------------------------------------
// Direct messages (admin <-> a single user)
// ---------------------------------------------------------------------------

export async function fetchDirectMessages(
  supabase: SupabaseClient,
  userId: string,
  otherUserId: string,
): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("direct_messages")
    .select("id, sender_id, recipient_id, body, created_at, read_at")
    .or(
      `and(sender_id.eq.${userId},recipient_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},recipient_id.eq.${userId})`,
    )
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return rowsOf(data)
    .map((row) => {
      const id = readText(row.id);
      const senderId = readText(row.sender_id);
      const body = readText(row.body);
      const createdAt = readText(row.created_at);
      const recipientId = readText(row.recipient_id);
      // Reuse ChatMessage with appointmentId = the other party's id for threading.
      if (!id || !senderId || !body || !createdAt) return null;
      return {
        id,
        appointmentId: recipientId,
        senderId,
        body,
        createdAt,
        readAt: typeof row.read_at === "string" ? row.read_at : null,
      } as ChatMessage;
    })
    .filter((message): message is ChatMessage => message !== null);
}

export async function sendDirectMessage(
  supabase: SupabaseClient,
  senderId: string,
  recipientId: string,
  body: string,
): Promise<ChatMessage> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Message cannot be empty.");

  const { data, error } = await supabase
    .from("direct_messages")
    .insert({ sender_id: senderId, recipient_id: recipientId, body: trimmed })
    .select("id, sender_id, recipient_id, body, created_at, read_at")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not send message.");
  }

  const row = data as Row;
  const message: ChatMessage = {
    id: readText(row.id),
    appointmentId: readText(row.recipient_id),
    senderId: readText(row.sender_id),
    body: readText(row.body),
    createdAt: readText(row.created_at),
    readAt: typeof row.read_at === "string" ? row.read_at : null,
  };
  return message;
}

export async function markDirectMessagesRead(
  supabase: SupabaseClient,
  readerId: string,
  otherUserId: string,
): Promise<void> {
  await supabase
    .from("direct_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", readerId)
    .eq("sender_id", otherUserId)
    .is("read_at", null);
}

export async function fetchUnreadDirectCountsBySender(
  supabase: SupabaseClient,
  recipientId: string,
): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("direct_messages")
    .select("sender_id")
    .eq("recipient_id", recipientId)
    .is("read_at", null);

  if (error) return {};

  const counts: Record<string, number> = {};
  for (const row of rowsOf(data)) {
    const id = readText(row.sender_id);
    if (id) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

export type Announcement = {
  id: string;
  senderId: string;
  title: string | null;
  body: string;
  targetRole: "all" | "patient" | "doctor";
  createdAt: string;
};

function toAnnouncement(row: Row): Announcement | null {
  const id = readText(row.id);
  const senderId = readText(row.sender_id);
  const body = readText(row.body);
  const createdAt = readText(row.created_at);
  if (!id || !senderId || !body || !createdAt) return null;
  const target = readText(row.target_role);
  return {
    id,
    senderId,
    title: typeof row.title === "string" ? row.title : null,
    body,
    targetRole:
      target === "patient" || target === "doctor" ? target : "all",
    createdAt,
  };
}

export async function fetchAnnouncements(
  supabase: SupabaseClient,
): Promise<Announcement[]> {
  const { data, error } = await supabase
    .from("announcements")
    .select("id, sender_id, title, body, target_role, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw new Error(error.message);
  return rowsOf(data)
    .map(toAnnouncement)
    .filter((a): a is Announcement => a !== null);
}

export async function createAnnouncement(
  supabase: SupabaseClient,
  senderId: string,
  body: string,
  targetRole: "all" | "patient" | "doctor",
  title?: string,
): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Announcement cannot be empty.");
  const { error } = await supabase.from("announcements").insert({
    sender_id: senderId,
    title: title?.trim() || null,
    body: trimmed,
    target_role: targetRole,
  });
  if (error) throw new Error(error.message);
}
