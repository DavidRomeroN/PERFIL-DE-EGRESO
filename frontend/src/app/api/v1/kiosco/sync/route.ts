import { z } from "zod";
import { error, ok, parseBody, publico, rateLimit } from "@backend/api";
import { autenticar, sincronizar } from "@backend/kiosco/service";

const evento = z.object({
  claveIdem: z.string().min(20).max(64),
  seq: z.number().int().min(1),
  tipo: z.enum(["EMITIR_TURNO", "CHECKIN_CITA"]),
  tsDispositivo: z.string(),
  offsetMsAlEmitir: z.number().int(),
  payload: z.object({ colaId: z.number().int().positive().optional(), categoria: z.string().max(16).nullable().optional(), nombre: z.string().max(60).nullable().optional(), telefono: z.string().max(20).nullable().optional(), consentimiento: z.boolean().optional(), codigoCita: z.string().max(8).optional() }),
});
const schema = z.object({ eventos: z.array(evento).max(100) });

/** POST /api/v1/kiosco/sync — lote de hasta 100 eventos offline; cada uno idempotente (§6.4) */
export const POST = publico(async (req) => {
  if (!await rateLimit(req, "kiosco-sync", 60)) return error("RATE_LIMIT", "Demasiadas solicitudes.", 429);
  const d = await autenticar(req);
  const raw = (await req.clone().json().catch(() => ({}))) as { eventos?: unknown[] };
  if ((raw.eventos?.length ?? 0) > 100) return error("M5_LOTE_DEMASIADO_GRANDE", "Máximo 100 eventos por lote", 413);
  return ok(await sincronizar(d, (await parseBody(req, schema)).eventos));
});
