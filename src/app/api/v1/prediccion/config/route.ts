import { z } from "zod";
import { auditar, ok, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ADMIN, enLocal } from "@/lib/rutas";
import { invalidarModelo, leerConfig } from "@/lib/prediccion/service";

const schema = z.object({
  modelo: z.enum(["AUTO", "BASELINE", "EMA", "ESTACIONAL"]),
  alfaEma: z.number().min(0.05).max(0.5),
  nivelConfianza: z.union([z.literal(0.8), z.literal(0.9)]),
  diasEntrenamiento: z.number().int().min(14).max(180),
});

export const GET = enLocal(ADMIN, "M2", async (_req, ctx) => ok(await leerConfig(ctx.localId)));

/** PUT /api/v1/prediccion/config — auditado (§11) */
export const PUT = enLocal(ADMIN, "M2", async (req, ctx) => {
  const b = await parseBody(req, schema);
  await prisma.configPrediccion.upsert({ where: { localId: ctx.localId }, create: { localId: ctx.localId, ...b }, update: b });
  invalidarModelo();
  await auditar(ctx, { localId: ctx.localId, accion: "PREDICCION_CONFIG", entidad: "config_prediccion", entidadId: ctx.localId, humana: `Configuró la predicción (${b.modelo}, α=${b.alfaEma}, ${b.nivelConfianza * 100} %)`, datos: b });
  return ok(await leerConfig(ctx.localId));
});
