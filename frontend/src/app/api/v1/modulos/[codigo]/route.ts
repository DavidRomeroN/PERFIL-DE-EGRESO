import { z } from "zod";
import { auditar, error, ok, paramsDe, parseBody } from "@backend/api";
import { ADMIN, enLocal } from "@backend/rutas";
import { MODULOS, cambiarModulo, estadoModulos } from "@backend/modulos";
import { sembrarPrioridades } from "@backend/prioridades/service";
import type { ModuloCodigo } from "@backend/generated/prisma/client";

const schema = z.object({ habilitado: z.boolean() });

/** PUT /api/v1/modulos/:codigo — interruptor del módulo en el local (auditado) */
export const PUT = enLocal<{ params: Promise<{ codigo: string }> }>(ADMIN, null, async (req, ctx) => {
  const { codigo } = await paramsDe(ctx);
  if (!MODULOS.some((m) => m.codigo === codigo)) return error("VALIDACION", "Módulo desconocido", 404);
  const b = await parseBody(req, schema);
  await cambiarModulo(ctx.localId, codigo as ModuloCodigo, b.habilitado);
  if (b.habilitado && (codigo === "M1" || codigo === "M3")) await sembrarPrioridades(ctx.localId);
  await auditar(ctx, { localId: ctx.localId, accion: b.habilitado ? "MODULO_ACTIVAR" : "MODULO_DESACTIVAR", entidad: "local_modulo", entidadId: codigo, humana: `${b.habilitado ? "Activó" : "Desactivó"} el módulo ${codigo}` });
  return ok(await estadoModulos(ctx.localId));
});
