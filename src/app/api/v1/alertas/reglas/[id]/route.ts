import { z } from "zod";
import { error, ok, paramsDe, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ADMIN, enLocal } from "@/lib/rutas";
import type { Prisma } from "@/generated/prisma/client";

const schema = z.object({ nombre: z.string().trim().min(3).max(80).optional(), umbral: z.record(z.string(), z.number()).optional(), niveles: z.array(z.object({ traMin: z.number().int().min(0).max(1440), canales: z.array(z.enum(["IN_APP", "WHATSAPP", "CORREO"])).min(1), usuarios: z.array(z.number().int()).optional() })).min(1).max(3).optional(), resolverTrasMin: z.number().int().min(1).max(240).optional(), activa: z.boolean().optional(), silenciadaHasta: z.string().datetime().nullable().optional() });
type P = { params: Promise<{ id: string }> };

export const PATCH = enLocal<P>(ADMIN, "M7", async (req, ctx) => {
  const id = Number((await paramsDe(ctx)).id);
  const r = await prisma.reglaAlerta.findFirst({ where: { id, localId: ctx.localId } });
  if (!r) return error("M7_REGLA_INVALIDA", "La regla no existe", 404);
  const b = await parseBody(req, schema);
  return ok(await prisma.reglaAlerta.update({ where: { id }, data: { ...b, umbral: b.umbral as Prisma.InputJsonValue | undefined, niveles: b.niveles as Prisma.InputJsonValue | undefined, silenciadaHasta: b.silenciadaHasta === undefined ? undefined : b.silenciadaHasta ? new Date(b.silenciadaHasta) : null } }));
});

export const DELETE = enLocal<P>(ADMIN, "M7", async (_req, ctx) => {
  const r = await prisma.reglaAlerta.deleteMany({ where: { id: Number((await paramsDe(ctx)).id), localId: ctx.localId } });
  if (!r.count) return error("M7_REGLA_INVALIDA", "La regla no existe", 404);
  return ok({ eliminada: true });
});
