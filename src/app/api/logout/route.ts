import { NextResponse } from "next/server";
import { getCookieToken, destroySession, clearSessionCookie } from "@/lib/auth";

export async function POST() {
  const token = await getCookieToken();
  if (token) destroySession(token);
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}