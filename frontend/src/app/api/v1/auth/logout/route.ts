import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@backend/auth";

export async function POST() {
  const res = NextResponse.json({ ok: true, data: null });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
