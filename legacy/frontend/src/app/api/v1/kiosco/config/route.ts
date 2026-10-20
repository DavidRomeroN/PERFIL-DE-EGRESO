import { ok, publico } from "@backend/api";
import { autenticar, configDispositivo } from "@backend/kiosco/service";

/** GET /api/v1/kiosco/config — Bearer del dispositivo */
export const GET = publico(async (req) => {
  const d = await autenticar(req);
  return ok(await configDispositivo(d.id));
});
