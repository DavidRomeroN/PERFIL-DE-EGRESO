import { z } from "zod";
import { ok, paramsDe, parseBody } from "@backend/api";
import { STAFF, enLocal } from "@backend/rutas";
import { cambiarPrioridadTurno } from "@backend/prioridades/service";

const schema = z.object({
  accion: z.enum(["VERIFICAR", "RECHAZAR", "CAMBIAR"]),
  categoriaCodigo: z.string().max(16).optional().nullable(),
});

/** PATCH /api/v1/turnos/:id/prioridad — verificar, rechazar (pasa a General conservando su hora) o cambiar (RF-M1-07) */
export const PATCH = enLocal<{ params: Promise<{ id: string }> }>(STAFF, "M1", async (req, ctx) => {
  const { id } = await paramsDe(ctx);
  const b = await parseBody(req, schema);
  const t = await cambiarPrioridadTurno(ctx, ctx.localId, Number(id), b.accion, b.categoriaCodigo);
  return ok({ id: t?.id, categoria: t?.categoria?.codigo ?? "GENERAL", prioridadVerificada: t?.prioridadVerificada ?? null });
});
