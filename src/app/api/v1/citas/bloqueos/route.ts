import { z } from "zod";
import { ok, parseBody } from "@/lib/api";
import { ADMIN, enLocal } from "@/lib/rutas";
import { crearBloqueoAgenda, listarBloqueos } from "@/lib/citas/service";

const schema = z.object({ colaId: z.number().int().positive().nullable().optional(), inicio: z.string().datetime(), fin: z.string().datetime(), motivo: z.string().trim().min(2).max(120) });

export const GET = enLocal(ADMIN, "M3", async (_req, ctx) => ok(await listarBloqueos(ctx.localId)));

/** POST /api/v1/citas/bloqueos — feriados u horas sin atención */
export const POST = enLocal(ADMIN, "M3", async (req, ctx) => {
  const b = await parseBody(req, schema);
  return ok(await crearBloqueoAgenda(ctx.localId, { colaId: b.colaId ?? null, inicio: new Date(b.inicio), fin: new Date(b.fin), motivo: b.motivo }), { status: 201 });
});
