import { z } from "zod";
import { auditar, error, ok, parseBody, rateLimit } from "@/lib/api";
import { ADMIN, enLocal } from "@/lib/rutas";
import { pagarPlan } from "@/lib/pagos/service";
import { tarjetaSchema } from "@/lib/schemas";

const schema = z.object({ plan: z.enum(["EMPRENDE", "PRO"]), meses: z.number().int().min(1).max(12), claveIdem: z.string().uuid(), tarjeta: tarjetaSchema });

/** POST /api/v1/pagos/plan — cambiar o renovar el plan del local pagando con tarjeta (Checkout API). */
export const POST = enLocal(ADMIN, null, async (req, ctx) => {
  if (!await rateLimit(req, "pago-plan", 5)) return error("RATE_LIMIT", "Demasiados intentos. Espera un minuto.", 429);
  const b = await parseBody(req, schema);
  const r = await pagarPlan(ctx.localId, b.plan, b.meses, b.tarjeta, b.claveIdem, ctx.session.sub);
  await auditar(ctx, { localId: ctx.localId, accion: "PAGO_PLAN", entidad: "pago", entidadId: r.pagoId, humana: `Pagó el plan ${b.plan} por ${b.meses} mes(es): ${r.estado}` });
  return ok(r, { status: r.estado === "APROBADO" ? 201 : 202 });
});
