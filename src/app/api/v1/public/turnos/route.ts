import { z } from "zod";
import { error, ok, parseBody, publico, rateLimit } from "@/lib/api";
import { emitirTurno } from "@/lib/turnos";

const schema = z.object({
  colaId: z.coerce.number().int().positive(),
  nombre: z.string().trim().max(60).optional().nullable(),
  telefono: z.string().trim().max(20).optional().nullable(),
  consentimiento: z.boolean().optional().default(false),
  categoriaCodigo: z.string().trim().max(40).optional().nullable(),
});

/** POST /api/v1/public/turnos — RF01 tomar turno por QR (rate limit 5/min por IP) */
export const POST = publico(async (req) => {
  if (!await rateLimit(req, "turnos", 5)) return error("RATE_LIMIT", "Demasiadas solicitudes. Intenta en un minuto.", 429);
  const body = await parseBody(req, schema);
  const turno = await emitirTurno({
    colaId: body.colaId,
    nombre: body.nombre ?? null,
    telefono: body.telefono?.trim() ? body.telefono : null,
    consentimiento: body.consentimiento,
    canal: "QR",
    categoriaCodigo: body.categoriaCodigo ?? null,
  });
  return ok(turno, { status: 201 });
});
