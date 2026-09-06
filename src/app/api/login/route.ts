import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyPassword, isSetup, createSession, setSessionCookie } from "@/lib/auth";

export async function POST(req: Request) {
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