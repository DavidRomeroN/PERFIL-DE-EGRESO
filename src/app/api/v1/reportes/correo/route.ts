import { conRol, ok } from "@/lib/api";
import { localDeSesion } from "@/lib/admin";
import { reportePorCorreo } from "@/lib/correo";

export const POST = conRol(["ADMIN_LOCAL", "SUPER_ADMIN"], async (req, ctx) => {
  const localId = await localDeSesion(req, ctx.session);
  return ok(await reportePorCorreo(localId));
});
