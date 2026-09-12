import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyPassword, isSetup, createSession, setSessionCookie } from "@/lib/auth";
import { consumeAuthAttempt, getAuthClientId } from "@/lib/auth-rate-limit";

export async function POST(req: Request) {
  const attempt = consumeAuthAttempt(getAuthClientId(req));
  if (!attempt.allowed) {
    return NextResponse.json(
      { error: `Too many authentication attempts. Try again in ${attempt.retryAfterSeconds} seconds.` },
      { status: 429, headers: { "Retry-After": String(attempt.retryAfterSeconds) } },
    );
  }
  if (!isSetup()) return NextResponse.json({ error: "Not set up." }, { status: 400 });
  const { password } = await req.json().catch(() => ({}));
  const stored = getDb().prepare(`SELECT value FROM settings WHERE key = 'password_hash'`).get() as { value: string } | undefined;
  if (typeof password !== "string" || !stored || !verifyPassword(password, stored.value)) {
    return NextResponse.json({ error: "Invalid password." }, { status: 401 });
  }
  const token = createSession();
  await setSessionCookie(token);
  return NextResponse.json({ ok: true });
}
