import { z } from "zod";
import { error, ok, parseBody, publico, rateLimit } from "@/lib/api";
import { aplicarEvento, autenticar } from "@/lib/kiosco/service";

const schema = z.object({
  claveIdem: z.string().min(20).max(64),
  seq: z.number().int().min(1),
  tsDispositivo: z.string(),
  offsetMsAlEmitir: z.number().int().default(0),
  colaId: z.number().int().positive(),
  categoria: z.string().max(16).nullable().optional(),
  nombre: z.string().max(60).nullable().optional(),
  telefono: z.string().max(20).nullable().optional(),
  consentimiento: z.boolean().optional(),
});

/** POST /api/v1/kiosco/turnos — emisión online idempotente por claveIdem (Bearer del dispositivo) */
export const POST = publico(async (req) => {
  if (!await rateLimit(req, "kiosco", 60)) return error("RATE_LIMIT", "Demasiadas solicitudes.", 429);
  const d = await autenticar(req);
  const b = await parseBody(req, schema);
  const r = await aplicarEvento(d, { claveIdem: b.claveIdem, seq: b.seq, tipo: "EMITIR_TURNO", tsDispositivo: b.tsDispositivo, offsetMsAlEmitir: b.offsetMsAlEmitir, payload: { colaId: b.colaId, categoria: b.categoria, nombre: b.nombre, telefono: b.telefono, consentimiento: b.consentimiento } });
  return ok(r, { status: r.estado === "APLICADO" ? 201 : 200 });
});
