import { NextResponse } from "next/server";

function sanitizeRoomName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export async function POST(request: Request) {
  let body: { appointmentId?: string; name?: string } = {};
  try {
    body = (await request.json()) as { appointmentId?: string; name?: string };
  } catch {
    body = {};
  }

  const base =
    body.name ||
    (body.appointmentId ? `carepulse-${body.appointmentId}` : `carepulse-${Date.now()}`);
  const roomName = sanitizeRoomName(base) || `carepulse-${Date.now()}`;

  return NextResponse.json({
    name: roomName,
    url: `https://meet.jit.si/${roomName}`,
  });
}
