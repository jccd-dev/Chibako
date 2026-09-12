import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { hashPassword, isSetup, createSession, setSessionCookie } from "@/lib/auth";
import { ensureIndexNote } from "@/lib/notes";
import { consumeAuthAttempt, getAuthClientId } from "@/lib/auth-rate-limit";

export async function POST(req: Request) {
  const attempt = consumeAuthAttempt(getAuthClientId(req));
  if (!attempt.allowed) {
    return NextResponse.json(
      { error: `Too many authentication attempts. Try again in ${attempt.retryAfterSeconds} seconds.` },
      { status: 429, headers: { "Retry-After": String(attempt.retryAfterSeconds) } },
    );
  }
  if (isSetup()) {
    return NextResponse.json({ error: "Already set up." }, { status: 400 });
  }
  const { password } = await req.json().catch(() => ({}));
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }
  const db = getDb();
  db.prepare(`INSERT INTO settings (key, value) VALUES ('password_hash', ?)`).run(hashPassword(password));
  db.prepare(`INSERT INTO settings (key, value) VALUES ('site_name', 'Chibako')`).run();
  ensureIndexNote();
  const token = createSession();
  await setSessionCookie(token);
  return NextResponse.json({ ok: true });
}
