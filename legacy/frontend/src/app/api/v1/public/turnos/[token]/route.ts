import { ok, paramsDe, publico } from "@backend/api";
import { cancelarTurno, obtenerTurnoPorToken } from "@backend/turnos";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/** GET /api/v1/public/turnos/:token — RF02 estado del turno */
export const GET = publico<Ctx>(async (_req, ctx) => {
  const { token } = await paramsDe(ctx);
  return ok(await obtenerTurnoPorToken(token), { headers: { "Cache-Control": "no-store" } });
});

/** DELETE /api/v1/public/turnos/:token — RF04 cancelar turno */
export const DELETE = publico<Ctx>(async (_req, ctx) => {
  const { token } = await paramsDe(ctx);
  return ok(await cancelarTurno(token));
});
