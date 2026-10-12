import { z } from "zod";
import { error, ok, parseBody, publico, rateLimit } from "@/lib/api";
import { autenticar, verificarPinMantenimiento } from "@/lib/kiosco/service";

const schema = z.object({ pin: z.string().regex(/^\d{4,8}$/) });

/** POST /api/v1/kiosco/mantenimiento — valida el PIN del menú oculto (RF-M5-10) */
export const POST = publico(async (req) => {
  if (!await rateLimit(req, "kiosco-pin", 5)) return error("RATE_LIMIT", "Demasiados intentos.", 429);
  const d = await autenticar(req);
  return ok({ valido: await verificarPinMantenimiento(d.id, (await parseBody(req, schema)).pin) });
});
