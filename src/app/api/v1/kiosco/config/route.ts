import { ok, publico } from "@/lib/api";
import { autenticar, configDispositivo } from "@/lib/kiosco/service";

/** GET /api/v1/kiosco/config — Bearer del dispositivo */
export const GET = publico(async (req) => {
  const d = await autenticar(req);
  return ok(await configDispositivo(d.id));
});
