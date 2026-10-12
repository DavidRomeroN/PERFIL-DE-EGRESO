import { z } from "zod";
import { ok, paramsDe, parseBody } from "@/lib/api";
import { ADMIN, enLocal } from "@/lib/rutas";
import { accionAdmin } from "@/lib/citas/service";

const schema = z.object({ accion: z.enum(["CANCELAR", "MOVER", "NO_SHOW", "ASISTIO"]), slotId: z.number().int().positive().optional() });

/** PATCH /api/v1/citas/:id — acciones del admin sobre una cita */
export const PATCH = enLocal<{ params: Promise<{ id: string }> }>(ADMIN, "M3", async (req, ctx) => {
  const { id } = await paramsDe(ctx);
  const b = await parseBody(req, schema);
  const r = await accionAdmin(ctx.localId, Number(id), b.accion, b.slotId, `usuario:${ctx.session.sub}`);
  return ok({ id: r.id, estado: "estado" in r ? r.estado : undefined });
});
