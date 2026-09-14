import { NextResponse } from "next/server";
import { isSetup } from "@/server/auth/password-authentication";
import { createSession, setSessionCookie } from "@/lib/auth";
import { setupVault, VaultAlreadySetupError } from "@/server/setup-vault";
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
  try {
    setupVault(password);
  } catch (error) {
    if (error instanceof VaultAlreadySetupError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
  const token = createSession();
  await setSessionCookie(token);
  return NextResponse.json({ ok: true });
}
