import { z } from "zod";
import { error, ok, parseBody, publico, rateLimit } from "@/lib/api";
import { crearCita } from "@/lib/operacion";
import { prisma } from "@/lib/db";

const schema = z.object({
  slug: z.string().min(2),
  colaId: z.number().int(),
  inicioISO: z.string(),
  nombre: z.string().min(2).max(60),
  telefono: z.string().max(20).optional().nullable(),
  consentimiento: z.boolean().optional(),
});

export const POST = publico(async (req) => {
  if (!rateLimit(req, "citas", 8)) return error("RATE_LIMIT", "Demasiadas solicitudes. Intenta en un minuto.", 429);
  const body = await parseBody(req, schema);
  if (body.telefono && !body.consentimiento) return error("CONSENTIMIENTO_REQUERIDO", "Acepta la política de datos para guardar el celular", 422);
  const cola = await prisma.cola.findFirst({ where: { id: body.colaId, activa: true, local: { slug: body.slug, activo: true } } });
  if (!cola) return error("COLA_INACTIVA", "La cola no pertenece a ese local", 404);
  const cita = await crearCita({ localId: cola.localId, colaId: cola.id, inicioISO: body.inicioISO, nombre: body.nombre, telefono: body.telefono });
  return ok(cita, { status: 201 });
});
