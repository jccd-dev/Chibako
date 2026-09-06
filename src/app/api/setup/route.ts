import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { hashPassword, isSetup, createSession, setSessionCookie } from "@/lib/auth";
import { ensureIndexNote } from "@/lib/notes";

export async function POST(req: Request) {
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