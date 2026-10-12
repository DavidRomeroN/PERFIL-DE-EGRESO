import { paramsDe } from "@/lib/api";
import { ADMIN, enLocal } from "@/lib/rutas";
import { leerArchivo } from "@/lib/analitica/reportes";

/** GET /api/v1/reportes-generados/:id/descargar — solo autenticado y del mismo local */
export const GET = enLocal<{ params: Promise<{ id: string }> }>(ADMIN, "M7", async (_req, ctx) => {
  const a = await leerArchivo(ctx.localId, BigInt((await paramsDe(ctx)).id));
  return new Response(new Uint8Array(a.contenido), { headers: { "Content-Type": a.tipo, "Content-Disposition": `attachment; filename="${a.nombre}"` } });
});
