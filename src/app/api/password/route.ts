import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { getPasswordHash, setPassword, verifyPassword } from "@/server/auth/password-authentication";
import { destroyOtherSessions, getCookieToken } from "@/lib/auth";
import { consumeAuthAttempt, getAuthClientId } from "@/lib/auth-rate-limit";
import { getNewPasswordError } from "@/lib/password-policy";
import { z } from "zod";

const passwordInput = z.object({ current: z.string(), next: z.string() });

export const POST = withAuth("*", async (req) => {
  const attempt = consumeAuthAttempt(getAuthClientId(req));
  if (!attempt.allowed) {
    return NextResponse.json(
      { error: `Too many authentication attempts. Try again in ${attempt.retryAfterSeconds} seconds.` },
      { status: 429, headers: { "Retry-After": String(attempt.retryAfterSeconds) } },
    );
  }
  const parsed = passwordInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid password request." }, { status: 400 });
  const { current, next } = parsed.data;
  const error = getNewPasswordError(next);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const stored = getPasswordHash();
  if (!stored || !verifyPassword(current, stored)) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
  }
  setPassword(next);
  destroyOtherSessions(await getCookieToken());
  return NextResponse.json({ ok: true });
});
