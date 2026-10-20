import { ok } from "@backend/api";
import { ADMIN, enLocal, q, qNum } from "@backend/rutas";
import { listarEventos } from "@backend/kiosco/service";

/** GET /api/v1/kiosco/eventos?estado&dispositivoId&cursor — cola de sincronización */
export const GET = enLocal(ADMIN, "M5", async (req, ctx) => {
  const c = q(req, "cursor");
  return ok(await listarEventos(ctx.localId, { estado: q(req, "estado") ?? undefined, dispositivoId: qNum(req, "dispositivoId") ?? undefined, cursor: c ? BigInt(c) : undefined }));
});
