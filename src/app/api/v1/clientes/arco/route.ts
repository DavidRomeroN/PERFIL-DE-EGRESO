import { z } from "zod";
import { auditar, ok, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { hashTelefono, normalizarTelefono } from "@/lib/crypto";
import { ErrorNegocio } from "@/lib/errores";
import { ADMIN, enLocal } from "@/lib/rutas";

const schema = z.object({ telefono: z.string().min(9).max(20), accion: z.enum(["CONSULTAR", "ANONIMIZAR"]) });

/**
 * POST /api/v1/clientes/arco — derechos ARCO (Ley 29733, §9.1): consulta qué hay y anonimiza los datos del celular.
 * Solo afecta a clientes con turnos/citas del local del admin.
 */
export const POST = enLocal(ADMIN, null, async (req, ctx) => {
  const b = await parseBody(req, schema);
  const tel = normalizarTelefono(b.telefono);
  if (!tel) throw new ErrorNegocio("TELEFONO_INVALIDO", "Celular inválido", 422);
  const clientes = await prisma.cliente.findMany({ where: { telefonoHash: hashTelefono(tel), OR: [{ turnos: { some: { localId: ctx.localId } } }, { citas: { some: { localId: ctx.localId } } }] }, include: { _count: { select: { turnos: true, citas: true } } } });
  if (b.accion === "CONSULTAR") return ok({ clientes: clientes.map((c) => ({ id: c.id, nombre: c.nombre, turnos: c._count.turnos, citas: c._count.citas, desde: c.createdAt })) });
  const ids = clientes.map((c) => c.id);
  await prisma.cliente.updateMany({ where: { id: { in: ids } }, data: { nombre: null, telefonoCifrado: null, telefonoHash: null } });
  const conv = await prisma.conversacionBot.deleteMany({ where: { localId: ctx.localId, telefonoHash: hashTelefono(tel) } });
  await auditar(ctx, { localId: ctx.localId, accion: "ARCO_ANONIMIZAR", entidad: "cliente", humana: `Anonimizó ${ids.length} registros de cliente por solicitud ARCO`, datos: { clientes: ids.length, conversaciones: conv.count } });
  return ok({ anonimizados: ids.length, conversacionesEliminadas: conv.count });
});
