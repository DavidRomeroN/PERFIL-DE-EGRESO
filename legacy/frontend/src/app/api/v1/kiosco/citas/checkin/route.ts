import { z } from "zod";
import { ok, parseBody, publico } from "@backend/api";
import { autenticar } from "@backend/kiosco/service";
import { checkinPorCodigo } from "@backend/citas/service";

const schema = z.object({ codigo: z.string().trim().min(6).max(16) });

/** POST /api/v1/kiosco/citas/checkin — por código o QR; estar frente al kiosco prueba presencia (sin PIN) */
export const POST = publico(async (req) => {
  const d = await autenticar(req);
  const b = await parseBody(req, schema);
  const codigo = b.codigo.includes("/") ? b.codigo.split("/").pop()! : b.codigo;
  return ok(await checkinPorCodigo(d.localId, codigo));
});
