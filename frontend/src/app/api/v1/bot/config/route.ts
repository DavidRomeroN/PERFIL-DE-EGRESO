import { z } from "zod";
import { auditar, ok, parseBody } from "@backend/api";
import { ADMIN, enLocal } from "@backend/rutas";
import { configBot, guardarConfigBot } from "@backend/bot/service";

const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
const schema = z.object({
  proveedor: z.enum(["openwa", "meta"]).optional(),
  identificador: z.string().trim().min(2).max(80).optional(),
  botActivo: z.boolean().optional(),
  bienvenida: z.string().trim().max(300).nullable().optional(),
  atencionHumana: z.object({ dias: z.array(z.number().int().min(0).max(6)).max(7), desde: hhmm, hasta: hhmm }).nullable().optional(),
});

export const GET = enLocal(ADMIN, "M4", async (_req, ctx) => ok(await configBot(ctx.localId)));

/** PUT /api/v1/bot/config — canal (sesión OpenWA / phone_number_id), bienvenida, horario humano, interruptor */
export const PUT = enLocal(ADMIN, "M4", async (req, ctx) => {
  const b = await parseBody(req, schema);
  const r = await guardarConfigBot(ctx.localId, b);
  await auditar(ctx, { localId: ctx.localId, accion: "BOT_CONFIG", entidad: "canal_whatsapp", entidadId: r.id, humana: `Configuró el chatbot (${r.botActivo ? "activo" : "inactivo"})` });
  return ok(r);
});
