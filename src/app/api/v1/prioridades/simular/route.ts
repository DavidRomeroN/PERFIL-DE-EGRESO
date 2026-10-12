import { z } from "zod";
import { ok, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ADMIN, enLocal } from "@/lib/rutas";
import { leerConfig } from "@/lib/prioridades/service";
import { simular } from "@/lib/prioridades/reglas";

const schema = z.object({
  config: z.object({ alfaPuntosPorMin: z.number().min(0).max(10), topeAdelantos: z.number().int().min(0).max(10), agingActivo: z.boolean() }).optional(),
  turnos: z.array(z.object({ codigo: z.string().max(12), categoria: z.string().max(16), esperaMin: z.number().min(0).max(600) })).min(1).max(50),
  pesos: z.record(z.string(), z.number().int().min(0).max(1000)).optional(),
});

/** POST /api/v1/prioridades/simular — orden FIFO vs priorizado (RF-M1-09) */
export const POST = enLocal(ADMIN, "M1", async (req, ctx) => {
  const b = await parseBody(req, schema);
  const cfg = b.config ? { alfa: b.config.alfaPuntosPorMin, tope: b.config.topeAdelantos, aging: b.config.agingActivo } : await leerConfig(ctx.localId);
  const cats = await prisma.categoriaPrioridad.findMany({ where: { localId: ctx.localId, activa: true } });
  return ok(simular(b.turnos, cats.map((c) => ({ codigo: c.codigo, pesoBase: b.pesos?.[c.codigo] ?? c.pesoBase, absoluta: c.absoluta })), cfg));
});
