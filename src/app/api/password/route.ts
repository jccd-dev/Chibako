import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { getDb } from "@/lib/db";
import { verifyPassword, hashPassword } from "@/lib/auth";

export const POST = withAuth("*", async (req) => {
  const body = await req.json().catch(() => ({}));
  const { current, next } = body;
  if (typeof current !== "string" || typeof next !== "string" || next.length < 8) {
    return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
  }
  const db = getDb();
  const stored = db.prepare(`SELECT value FROM settings WHERE key = 'password_hash'`).get() as { value: string } | undefined;
  if (!stored || !verifyPassword(current, stored.value)) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
  }
  db.prepare(`UPDATE settings SET value = ? WHERE key = 'password_hash'`).run(hashPassword(next));
  return NextResponse.json({ ok: true });
});