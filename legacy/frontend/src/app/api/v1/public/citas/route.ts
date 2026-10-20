import { z } from "zod";
import { conIdempotencia, error, parseBody, publico, rateLimit } from "@backend/api";
import { reservar } from "@backend/citas/service";

const schema = z.object({
  slug: z.string().min(2).max(40),
  colaId: z.number().int().positive(),
  slotId: z.number().int().positive(),
  nombre: z.string().trim().min(2).max(60),
  telefono: z.string().trim().max(20).optional().nullable(),
  consentimiento: z.boolean().optional().default(false),
});

/** POST /api/v1/public/citas — reserva atómica sin sobrecupo; acepta Idempotency-Key (RNF-M3-03) */
export const POST = publico(async (req) => {
  if (!await rateLimit(req, "citas", 5)) return error("RATE_LIMIT", "Demasiadas solicitudes. Intenta en un minuto.", 429);
  const b = await parseBody(req, schema);
  return conIdempotencia(req, "POST /public/citas", async () => ({ status: 201, data: await reservar({ ...b, telefono: b.telefono || null, canal: "WEB" }) }));
});
