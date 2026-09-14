import { NextResponse } from "next/server";
import { checkDatabase } from "@/lib/db";

export async function GET() {
  try {
    checkDatabase();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}