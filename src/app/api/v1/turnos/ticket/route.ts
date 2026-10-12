import { z } from "zod";
import { conRol, error, ok, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { emitirTurno } from "@/lib/turnos";

const schema = z.object({
  colaId: z.coerce.number().int().positive(),
  nombre: z.string().trim().max(60).optional().nullable(),
  categoriaCodigo: z.string().trim().max(16).optional().nullable(),
});

/** POST /api/v1/turnos/ticket — RF07 ticket impreso para quien no tiene celular */
export const POST = conRol(["OPERADOR", "ADMIN_LOCAL", "SUPER_ADMIN"], async (req, ctx) => {
  const body = await parseBody(req, schema);
  const cola = await prisma.cola.findUnique({ where: { id: body.colaId }, select: { localId: true } });
  if (!cola) return error("COLA_INACTIVA", "La cola no existe", 404);
  if (ctx.session.rol !== "SUPER_ADMIN" && cola.localId !== ctx.session.localId) {
    return error("PROHIBIDO", "La cola pertenece a otro local", 403);
  }
  const turno = await emitirTurno({ colaId: body.colaId, nombre: body.nombre ?? null, canal: "TICKET", categoriaCodigo: body.categoriaCodigo, origenCategoria: "PERSONAL" });
  return ok(turno, { status: 201 });
});
