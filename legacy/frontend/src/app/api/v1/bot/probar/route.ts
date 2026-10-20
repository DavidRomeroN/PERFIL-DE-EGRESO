import { z } from "zod";
import { ok, parseBody } from "@backend/api";
import { ADMIN, enLocal } from "@backend/rutas";
import { probar } from "@backend/bot/service";
import type { Contexto, EstadoBot } from "@backend/bot/fsm";

const schema = z.object({ estado: z.string().max(30).optional(), contexto: z.record(z.string(), z.unknown()).optional(), texto: z.string().min(1).max(500) });

/** POST /api/v1/bot/probar — ejecuta la FSM sin enviar mensajes ni ejecutar efectos (RF-M4-11) */
export const POST = enLocal(ADMIN, "M4", async (req, ctx) => {
  const b = await parseBody(req, schema);
  return ok(await probar(ctx.localId, b.estado as EstadoBot | undefined, b.contexto as Contexto | undefined, b.texto));
});
