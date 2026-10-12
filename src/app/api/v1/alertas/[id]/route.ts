import { z } from "zod";
import { ok, paramsDe, parseBody } from "@/lib/api";
import { ADMIN, enLocal } from "@/lib/rutas";
import { accionAlerta, serializarAlerta } from "@/lib/analitica/alertas";

const schema = z.object({ accion: z.enum(["RECONOCER", "RESOLVER", "SILENCIAR", "REABRIR"]), hasta: z.string().datetime().optional() });

/** PATCH /api/v1/alertas/:id — ciclo de vida (RF-M7-07) */
export const PATCH = enLocal<{ params: Promise<{ id: string }> }>(ADMIN, "M7", async (req, ctx) => {
  const b = await parseBody(req, schema);
  const a = await accionAlerta(ctx.localId, BigInt((await paramsDe(ctx)).id), b.accion, ctx.session.sub, b.hasta ? new Date(b.hasta) : undefined);
  return ok(serializarAlerta(a));
});
