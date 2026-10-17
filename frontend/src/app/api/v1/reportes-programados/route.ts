import { z } from "zod";
import { ok, parseBody } from "@backend/api";
import { prisma } from "@backend/db";
import { ADMIN, enLocal } from "@backend/rutas";

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
});

export const GET = enLocal(ADMIN, "M7", async (_req, ctx) => ok(await prisma.reporteProgramado.findMany({ where: { localId: ctx.localId }, orderBy: { id: "asc" } })));

export const POST = enLocal(ADMIN, "M7", async (req, ctx) => ok(await prisma.reporteProgramado.create({ data: { localId: ctx.localId, ...(await parseBody(req, schema)) } }), { status: 201 }));
