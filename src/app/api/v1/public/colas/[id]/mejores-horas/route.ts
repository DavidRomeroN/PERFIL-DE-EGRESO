import { ok, paramsDe, publico } from "@/lib/api";
import { mejoresHoras } from "@/lib/prediccion/mejores";

export const GET = publico<{ params: Promise<{ id: string }> }>(async (_req, ctx) => {
  const { id } = await paramsDe(ctx);
  return ok(await mejoresHoras(Number(id)));
});
