import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { getPasswordHash, setPassword, verifyPassword } from "@/server/auth/password-authentication";
import { destroyOtherSessions, getCookieToken } from "@/lib/auth";

export const POST = withAuth("*", async (req) => {
  const body = await req.json().catch(() => ({}));
  const { current, next } = body;
  if (typeof current !== "string" || typeof next !== "string" || next.length < 8) {
    return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
  }
  const stored = getPasswordHash();
  if (!stored || !verifyPassword(current, stored)) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
  }
  setPassword(next);
  destroyOtherSessions(await getCookieToken());
  return NextResponse.json({ ok: true });
});