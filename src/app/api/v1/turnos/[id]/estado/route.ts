import { z } from "zod";
import { conRol, error, ok, paramsDe, parseBody } from "@/lib/api";
import { cambiarEstadoTurno } from "@/lib/turnos";

const schema = z.object({
  estado: z.enum(["LLAMADO", "ATENDIDO", "NO_SE_PRESENTO", "CANCELADO"]),
});

/** PATCH /api/v1/turnos/:id/estado — RF06 atendido / no se presentó / rellamar */
export const PATCH = conRol<{ params: Promise<{ id: string }> }>(["OPERADOR", "ADMIN_LOCAL", "SUPER_ADMIN"], async (req, ctx) => {
  const { id } = await paramsDe(ctx);
  const body = await parseBody(req, schema);
  const url = new URL(req.url);
  const localId = ctx.session.rol === "SUPER_ADMIN" ? Number(url.searchParams.get("localId") ?? ctx.session.localId) : ctx.session.localId;
  if (!localId) return error("SIN_LOCAL", "El usuario no tiene un local asignado", 400);
  const turno = await cambiarEstadoTurno(Number(id), localId, body.estado);
  return ok({ id: turno.id, estado: turno.estado, rellamadas: turno.rellamadas });
});
