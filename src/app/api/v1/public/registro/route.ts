import { z } from "zod";
import { error, ok, parseBody, publico, rateLimit } from "@/lib/api";
import { registrar } from "@/lib/pagos/service";
import { tarjetaSchema } from "@/lib/schemas";

const schema = z.object({
  plan: z.enum(["GRATIS", "EMPRENDE", "PRO"]),
  nombreComercial: z.string().trim().min(2).max(80),
  razonSocial: z.string().trim().min(2).max(120),
  ruc: z.string().trim().regex(/^\d{11}$/, "El RUC tiene 11 dígitos").optional().nullable().or(z.literal("")),
  rubro: z.string().trim().min(2).max(40).default("Salud"),
  ciudad: z.string().trim().min(2).max(60).default("Juliaca"),
  direccion: z.string().trim().max(160).optional().nullable(),
  telefono: z.string().trim().max(20).optional().nullable(),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,40}$/, "Usa minúsculas, números y guiones (3–40)"),
  adminNombre: z.string().trim().min(2).max(80),
  adminEmail: z.string().trim().email("Correo inválido"),
  password: z.string().min(8, "Mínimo 8 caracteres").max(72),
  aceptaTerminos: z.literal(true, { message: "Debes aceptar los términos" }),
  claveIdem: z.string().uuid(),
  tarjeta: tarjetaSchema.optional().nullable(),
});

/**
 * POST /api/v1/public/registro — alta de un local.
 * Gratis: se crea al instante. Emprende/Pro: cobra el primer mes con la tarjeta tokenizada por el Card Payment Brick.
 */
export const POST = publico(async (req) => {
  if (!await rateLimit(req, "registro", 5)) return error("RATE_LIMIT", "Demasiados intentos. Espera un minuto.", 429);
  const { aceptaTerminos: _a, claveIdem, tarjeta, ...datos } = await parseBody(req, schema);
  void _a;
  const r = await registrar({ ...datos, ruc: datos.ruc || null }, tarjeta ?? null, claveIdem);
  return ok(r, { status: r.estado === "APROBADO" ? 201 : 202 });
});
