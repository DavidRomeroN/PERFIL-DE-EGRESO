import { z } from "zod";
import { conRol, ok, parseBody, publico } from "@/lib/api";
import { localActualAdmin } from "@/lib/admin";
import { crearCodigo, validarCodigo } from "@/lib/kiosco/emparejar";
import { ErrorNegocio } from "@/lib/turnos";

export const POST = conRol(["ADMIN_LOCAL", "SUPER_ADMIN"], async (_req, ctx) => {
  const local = await localActualAdmin(ctx.session);
  if (!local) throw new ErrorNegocio("SIN_LOCAL", "Elige un local", 409);
  return ok({ codigo: crearCodigo(local.id) });
});

const schema = z.object({ codigo: z.string().min(4) });

export const PUT = publico(async (req) => {
  const body = await parseBody(req, schema);
  const localId = validarCodigo(body.codigo);
  if (!localId) throw new ErrorNegocio("VALIDACION", "El código expiró o no existe", 401);
  return ok({ localId });
});
