import { conRol, error, ok } from "@backend/api";
import { prisma } from "@backend/db";
import { snapshotLocal } from "@backend/turnos";

export const dynamic = "force-dynamic";

/** GET /api/v1/panel/estado — snapshot del local del operador (incluye nombres) */
export const GET = conRol(["OPERADOR", "ADMIN_LOCAL", "SUPER_ADMIN"], async (req, ctx) => {
  const url = new URL(req.url);
  let slug = ctx.session.localSlug;
  if (ctx.session.rol === "SUPER_ADMIN" && url.searchParams.get("slug")) slug = url.searchParams.get("slug");
  if (!slug && ctx.session.rol === "SUPER_ADMIN") {
    const primero = await prisma.local.findFirst({ where: { activo: true }, orderBy: { id: "asc" } });
    slug = primero?.slug ?? null;
  }
  if (!slug) return error("SIN_LOCAL", "El usuario no tiene un local asignado", 400);
  const snap = await snapshotLocal(slug, { incluirNombres: true });
  return ok(snap, { headers: { "Cache-Control": "no-store" } });
});
