import { NextResponse } from "next/server";
import { getPasswordHash, verifyPassword, isSetup } from "@/server/auth/password-authentication";
import { createSession, setSessionCookie } from "@/lib/auth";
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
  const stored = getPasswordHash();
  if (typeof password !== "string" || !stored || !verifyPassword(password, stored)) {
    return NextResponse.json({ error: "Invalid password." }, { status: 401 });
  }
  const token = createSession();
  await setSessionCookie(token);
  return NextResponse.json({ ok: true });
}
