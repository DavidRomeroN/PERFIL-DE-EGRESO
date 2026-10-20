import { z } from "zod";
import { error, ok, parseBody, publico, rateLimit } from "@backend/api";
import { emparejar } from "@backend/kiosco/service";

const schema = z.object({ codigo: z.string().trim().min(6).max(8) });

/** POST /api/v1/kiosco/emparejar — canjea el código de 6 dígitos por el token del dispositivo */
export const POST = publico(async (req) => {
  if (!await rateLimit(req, "kiosco-emparejar", 5)) return error("RATE_LIMIT", "Demasiados intentos. Espera un minuto.", 429);
  return ok(await emparejar((await parseBody(req, schema)).codigo));
});
