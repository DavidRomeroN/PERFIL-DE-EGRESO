import { z } from "zod";
import { ok, parseBody, publico, rateLimit, error } from "@/lib/api";
import { emitirTurno } from "@/lib/turnos";
import { prisma } from "@/lib/db";

const schema = z.object({
  id: z.string().min(8),
  colaId: z.number().int(),
  nombre: z.string().max(60).optional().default(""),
});

const vistos = new Set<string>();

export const POST = publico(async (req) => {
  if (!rateLimit(req, "kiosco", 30)) return error("RATE_LIMIT", "Demasiadas solicitudes.", 429);
  const body = await parseBody(req, schema);
  if (vistos.has(body.id)) {
    const previo = await prisma.turno.findFirst({ where: { token: body.id.slice(0, 16) } });
    if (previo) return ok(previo);
    return error("REVISION", "Ese turno ya se envió y no se pudo confirmar. Reintenta con otro.", 409);
  }
  vistos.add(body.id);
  const turno = await emitirTurno({ colaId: body.colaId, nombre: body.nombre || null, canal: "KIOSCO" });
  return ok(turno, { status: 201 });
});
