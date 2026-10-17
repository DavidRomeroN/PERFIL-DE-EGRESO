import { timingSafeEqual } from "crypto";
import { getSession } from "@backend/auth";
import { exportarPrometheus } from "@backend/metricas";

export const dynamic = "force-dynamic";

/** F6: métricas en formato Prometheus. Requiere sesión SUPER_ADMIN o `Authorization: Bearer $METRICS_TOKEN`. */
export async function GET(req: Request) {
  const token = process.env.METRICS_TOKEN;
  const h = req.headers.get("authorization") ?? "";
  const porToken = !!token && h.startsWith("Bearer ") && h.length - 7 === token.length && timingSafeEqual(Buffer.from(h.slice(7)), Buffer.from(token));
  const session = porToken ? null : await getSession();
  if (!porToken && session?.rol !== "SUPER_ADMIN") return new Response("No autorizado", { status: 401 });
  return new Response(exportarPrometheus(), { headers: { "Content-Type": "text/plain; version=0.0.4" } });
}
