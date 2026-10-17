import { prisma } from "@backend/db";
import { ok } from "@backend/api";
import { ADMIN, enLocal, q, qNum } from "@backend/rutas";
import type { Prisma } from "@backend/generated/prisma/client";

/** GET /api/v1/auditoria?desde&hasta&usuarioId&accion&entidad&requestId&cursor&formato=csv — N01 */
export const GET = enLocal(ADMIN, null, async (req, ctx) => {
  const where: Prisma.AuditoriaWhereInput = { localId: ctx.localId };
  const d = q(req, "desde");
  const h = q(req, "hasta");
  if (d || h) where.createdAt = { ...(d ? { gte: new Date(`${d}T05:00:00Z`) } : {}), ...(h ? { lt: new Date(new Date(`${h}T05:00:00Z`).getTime() + 86400000) } : {}) };
  if (qNum(req, "usuarioId")) where.usuarioId = qNum(req, "usuarioId");
  if (q(req, "accion")) where.accion = { contains: q(req, "accion")!, mode: "insensitive" };
  if (q(req, "entidad")) where.entidad = q(req, "entidad")!;
  if (q(req, "requestId")) where.requestId = q(req, "requestId")!;
  if (q(req, "texto")) where.accionHumana = { contains: q(req, "texto")!, mode: "insensitive" };
  if (qNum(req, "cursor")) where.id = { lt: qNum(req, "cursor")! };
  const csv = q(req, "formato") === "csv";
  const filas = await prisma.auditoria.findMany({ where, orderBy: { id: "desc" }, take: csv ? 5000 : 50, include: { usuario: { select: { nombre: true, email: true } } } });
  if (csv) {
    const esc = (s: unknown) => { const t = s == null ? "" : typeof s === "string" ? s : JSON.stringify(s); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const cuerpo = ["id,fecha,usuario,accion,entidad,entidad_id,descripcion,ip,request_id,datos", ...filas.map((f) => [f.id, f.createdAt.toISOString(), f.usuario?.email ?? "sistema", f.accion, f.entidad, f.entidadId, f.accionHumana, f.ip, f.requestId, f.datosJson].map(esc).join(","))].join("\n");
    return new Response(cuerpo, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="auditoria.csv"' } });
  }
  return ok({ items: filas, cursor: filas.length === 50 ? filas[filas.length - 1].id : null });
});
