import { z } from "zod";
import { error, ok, paramsDe, parseBody, publico, rateLimit } from "@backend/api";
import { prisma } from "@backend/db";
import { obtenerCita, reprogramar } from "@backend/citas/service";

const schema = z.object({ slotId: z.number().int().positive() });

/** POST /api/v1/public/citas/:token/reprogramar — atómico: si el nuevo horario está lleno la cita se conserva */
export const POST = publico<{ params: Promise<{ token: string }> }>(async (req, ctx) => {
  if (!await rateLimit(req, "cita-reprogramar", 10)) return error("RATE_LIMIT", "Demasiadas solicitudes.", 429);
  const { token } = await paramsDe(ctx);
  const b = await parseBody(req, schema);
  const c = await prisma.cita.findUnique({ where: { token } });
  if (!c) return error("M3_CITA_NO_ENCONTRADA", "La cita no existe", 404);
  await reprogramar(c.id, b.slotId);
  return ok(await obtenerCita(token));
});
