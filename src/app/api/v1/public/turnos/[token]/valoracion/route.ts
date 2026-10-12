import { z } from "zod";
import { error, ok, paramsDe, parseBody, publico, rateLimit } from "@/lib/api";
import { valorarTurno } from "@/lib/operacion";

const schema = z.object({
  estrellas: z.number().int().min(1).max(5),
  comentario: z.string().max(280).optional().nullable(),
});

export const POST = publico<{ params: Promise<{ token: string }> }>(async (req, ctx) => {
  if (!rateLimit(req, "valoracion", 6)) return error("RATE_LIMIT", "Demasiadas solicitudes.", 429);
  const { token } = await paramsDe(ctx);
  const body = await parseBody(req, schema);
  return ok(await valorarTurno(token, body.estrellas, body.comentario));
});
