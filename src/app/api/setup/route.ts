import { NextResponse } from "next/server";
import { isSetup } from "@/server/auth/password-authentication";
import { createSession, setSessionCookie } from "@/lib/auth";
import { setupVault, VaultAlreadySetupError, VaultSetupTokenError } from "@/server/setup-vault";
import { consumeAuthAttempt, getAuthClientId } from "@/lib/auth-rate-limit";
import { getNewPasswordError } from "@/lib/password-policy";
import { z } from "zod";

const setupInput = z.object({ password: z.string(), setupToken: z.string().max(1024).optional() });

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
  const parsed = setupInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid setup request." }, { status: 400 });
  const { password, setupToken } = parsed.data;
  const error = getNewPasswordError(password);
  if (error) return NextResponse.json({ error }, { status: 400 });
  try {
    setupVault(password, setupToken);
  } catch (error) {
    if (error instanceof VaultSetupTokenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof VaultAlreadySetupError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
  const token = createSession();
  await setSessionCookie(token);
  return NextResponse.json({ ok: true });
}
