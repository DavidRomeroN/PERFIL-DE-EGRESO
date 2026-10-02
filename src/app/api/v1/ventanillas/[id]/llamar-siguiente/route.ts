import { conRol, error, ok, paramsDe } from "@/lib/api";
import { llamarSiguiente } from "@/lib/turnos";

/** POST /api/v1/ventanillas/:id/llamar-siguiente — RF05 */
export const POST = conRol<{ params: Promise<{ id: string }> }>(["OPERADOR", "ADMIN_LOCAL", "SUPER_ADMIN"], async (req, ctx) => {
  const { id } = await paramsDe(ctx);
  const url = new URL(req.url);
  const localId = ctx.session.rol === "SUPER_ADMIN" ? Number(url.searchParams.get("localId") ?? ctx.session.localId) : ctx.session.localId;
  if (!localId) return error("SIN_LOCAL", "El usuario no tiene un local asignado", 400);
  const turno = await llamarSiguiente(Number(id), localId);
  return ok({ turno, vacia: !turno });
});
