import { conRol, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { localDeSesion } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** GET /api/v1/notificaciones — bandeja de avisos enviados (WhatsApp / web) */
export const GET = conRol(["ADMIN_LOCAL", "SUPER_ADMIN", "OPERADOR"], async (req, ctx) => {
  const localId = await localDeSesion(req, ctx.session);
  const limit = Math.min(200, Number(new URL(req.url).searchParams.get("limit") ?? 60));
  const notificaciones = await prisma.notificacion.findMany({
    where: { turno: { localId } },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { turno: { select: { codigo: true, token: true, estado: true, cola: { select: { nombre: true } }, cliente: { select: { nombre: true } } } } },
  });
  const resumen = await prisma.notificacion.groupBy({
    by: ["estado"],
    where: { turno: { localId }, tipo: "WHATSAPP" },
    _count: { _all: true },
  });
  return ok(
    {
      notificaciones,
      resumen: Object.fromEntries(resumen.map((r) => [r.estado, r._count._all])),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
