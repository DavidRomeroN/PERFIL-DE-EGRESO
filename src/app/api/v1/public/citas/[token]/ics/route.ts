import { paramsDe, publico } from "@/lib/api";
import { icsDeCita } from "@/lib/citas/service";

/** GET /api/v1/public/citas/:token/ics — archivo de calendario con zona horaria y alarma −2 h */
export const GET = publico<{ params: Promise<{ token: string }> }>(async (_req, ctx) => {
  const { token } = await paramsDe(ctx);
  return new Response(await icsDeCita(token), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="cita-${token}.ics"` },
  });
});
