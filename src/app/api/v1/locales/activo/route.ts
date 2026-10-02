import { NextResponse } from "next/server";
import { z } from "zod";
import { conRol, error, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { LOCAL_COOKIE } from "@/lib/admin";

/** POST /api/v1/locales/activo — el super-admin elige el local sobre el que administra */
export const POST = conRol(["SUPER_ADMIN"], async (req) => {
  const { localId } = await parseBody(req, z.object({ localId: z.coerce.number().int().positive() }));
  const local = await prisma.local.findUnique({ where: { id: localId }, select: { id: true, slug: true, nombreComercial: true } });
  if (!local) return error("NO_ENCONTRADO", "Local no encontrado", 404);
  const res = NextResponse.json({ ok: true, data: local });
  res.cookies.set(LOCAL_COOKIE, String(local.id), { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30 });
  return res;
});
