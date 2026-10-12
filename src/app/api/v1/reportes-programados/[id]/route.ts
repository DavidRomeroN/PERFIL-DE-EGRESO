import { z } from "zod";
import { error, ok, paramsDe, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ADMIN, enLocal } from "@/lib/rutas";

const schema = z.object({
  nombre: z.string().trim().min(3).max(80),
  tipo: z.enum(["OPERATIVO_DIARIO", "SEMANAL_EJECUTIVO", "MENSUAL"]),
  frecuencia: z.enum(["DIARIO", "SEMANAL", "MENSUAL"]),
  diaSemana: z.number().int().min(0).max(6).nullable().optional(),
  diaMes: z.number().int().min(1).max(28).nullable().optional(),
  hora: z.string().regex(/^\d{2}:\d{2}$/),
  formato: z.array(z.enum(["PDF", "CSV"])).min(1),
  destinatarios: z.array(z.string().email("Correo inválido")).min(1).max(10),
  activo: z.boolean().optional(),
}).partial();
type P = { params: Promise<{ id: string }> };

export const PATCH = enLocal<P>(ADMIN, "M7", async (req, ctx) => {
  const id = Number((await paramsDe(ctx)).id);
  if (!(await prisma.reporteProgramado.findFirst({ where: { id, localId: ctx.localId } }))) return error("NO_ENCONTRADO", "La programación no existe", 404);
  return ok(await prisma.reporteProgramado.update({ where: { id }, data: await parseBody(req, schema) }));
});

export const DELETE = enLocal<P>(ADMIN, "M7", async (_req, ctx) => {
  const r = await prisma.reporteProgramado.deleteMany({ where: { id: Number((await paramsDe(ctx)).id), localId: ctx.localId } });
  if (!r.count) return error("NO_ENCONTRADO", "La programación no existe", 404);
  return ok({ eliminado: true });
});
