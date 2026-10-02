import { conRol, ok } from "@/lib/api";
import { localDeSesion } from "@/lib/admin";
import { fechaLocalISO, reporteEspera } from "@/lib/turnos";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/reportes/espera?desde=YYYY-MM-DD&hasta=YYYY-MM-DD[&formato=csv] — RF09
 */
export const GET = conRol(["ADMIN_LOCAL", "SUPER_ADMIN"], async (req, ctx) => {
  const localId = await localDeSesion(req, ctx.session);
  const url = new URL(req.url);
  const hoy = fechaLocalISO();
  const hace14 = fechaLocalISO("America/Lima", new Date(Date.now() - 13 * 86400000));
  const desde = url.searchParams.get("desde") ?? hace14;
  const hasta = url.searchParams.get("hasta") ?? hoy;

  const reporte = await reporteEspera(localId, desde, hasta);

  if (url.searchParams.get("formato") === "csv") {
    const cab = ["fecha", "codigo", "cola", "estado", "canal", "ventanilla", "emitido", "llamado", "finalizado", "espera_min", "atencion_min"];
    const filas = reporte.detalle.map((d) =>
      [d.fecha, d.codigo, d.cola, d.estado, d.canal, d.ventanilla, d.emitidoAt, d.llamadoAt, d.finalizadoAt, d.esperaMin, d.atencionMin]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
        .join(","),
    );
    const csv = "\uFEFF" + [cab.join(","), ...filas].join("\r\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="turnoya_reporte_${desde}_${hasta}.csv"`,
      },
    });
  }

  return ok(reporte, { headers: { "Cache-Control": "no-store" } });
});
