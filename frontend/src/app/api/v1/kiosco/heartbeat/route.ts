import { z } from "zod";
import { ok, parseBody, publico } from "@backend/api";
import { autenticar, heartbeat } from "@backend/kiosco/service";

const schema = z.object({ estado: z.string().max(20).optional(), pendientes: z.number().int().min(0).max(100000).optional(), version: z.string().max(20).optional(), impresora: z.string().max(40).optional(), offsetMs: z.number().optional() });

/** POST /api/v1/kiosco/heartbeat — cada 20 s; responde la hora del servidor para estimar el desfase */
export const POST = publico(async (req) => {
  const d = await autenticar(req);
  return ok(await heartbeat(d.id, await parseBody(req, schema)));
});
