import { ok } from "@/lib/api";
import { ADMIN, enLocal, q, qNum } from "@/lib/rutas";
import { listarEventos } from "@/lib/kiosco/service";

/** GET /api/v1/kiosco/eventos?estado&dispositivoId&cursor — cola de sincronización */
export const GET = enLocal(ADMIN, "M5", async (req, ctx) => {
  const c = q(req, "cursor");
  return ok(await listarEventos(ctx.localId, { estado: q(req, "estado") ?? undefined, dispositivoId: qNum(req, "dispositivoId") ?? undefined, cursor: c ? BigInt(c) : undefined }));
});
