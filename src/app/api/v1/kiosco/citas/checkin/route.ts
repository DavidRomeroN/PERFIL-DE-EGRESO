import { z } from "zod";
import { ok, parseBody, publico } from "@/lib/api";
import { autenticar } from "@/lib/kiosco/service";
import { checkinPorCodigo } from "@/lib/citas/service";

const schema = z.object({ codigo: z.string().trim().min(6).max(16) });

/** POST /api/v1/kiosco/citas/checkin — por código o QR; estar frente al kiosco prueba presencia (sin PIN) */
export const POST = publico(async (req) => {
  const d = await autenticar(req);
  const b = await parseBody(req, schema);
  const codigo = b.codigo.includes("/") ? b.codigo.split("/").pop()! : b.codigo;
  return ok(await checkinPorCodigo(d.localId, codigo));
});
