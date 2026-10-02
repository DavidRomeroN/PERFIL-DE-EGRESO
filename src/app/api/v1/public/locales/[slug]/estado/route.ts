import { ok, paramsDe, publico } from "@/lib/api";
import { snapshotLocal } from "@/lib/turnos";

export const dynamic = "force-dynamic";

/** GET /api/v1/public/locales/:slug/estado — snapshot de colas (pantalla TV) */
export const GET = publico<{ params: Promise<{ slug: string }> }>(async (_req, ctx) => {
  const { slug } = await paramsDe(ctx);
  const snap = await snapshotLocal(slug, { incluirNombres: false });
  return ok(snap, { headers: { "Cache-Control": "no-store" } });
});
