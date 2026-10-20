"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Seccion, Estado, Kpi, Tabla, useDatos, fmtFechaHora } from "@/components/app/modulo-ui";
import { TarjetaMercadoPago, type DatosTarjetaBrick } from "@/components/app/tarjeta-mercadopago";
import { api } from "@/lib/fetcher";

interface PlanInfo { codigo: string; nombre: string; precio: number; descripcion: string | null; modulos: string[] }
interface Datos {
  plan: { codigo: string; nombre: string; precio: number };
  venceAt: string | null;
  pagosHabilitados: boolean;
  planes: PlanInfo[];
  pagos: { id: number; fecha: string; plan: string; meses: number; monto: number; estado: string; detalle: string | null; metodo: string | null; ultimos4: string | null }[];
}
interface Resultado { estado: string; mensaje: string }

const ESTADO: Record<string, string> = { APROBADO: "Aprobado", EN_PROCESO: "En revisión", PENDIENTE: "Pendiente", RECHAZADO: "Rechazado", CANCELADO: "Cancelado", REEMBOLSADO: "Reembolsado" };

/** Plan actual del local, renovación o cambio de plan con tarjeta (Mercado Pago Card Payment Brick) e historial. */
export function MiPlan() {
  const { datos, error, cargando, recargar } = useDatos<Datos>("/api/v1/pagos");
  const [elegido, setElegido] = useState<string | null>(null);
  const [meses, setMeses] = useState(1);
  const [clave, setClave] = useState(() => crypto.randomUUID());

  const plan = datos?.planes.find((p) => p.codigo === elegido);
  const monto = plan ? plan.precio * meses : 0;
  const vencido = datos?.venceAt ? new Date(datos.venceAt).getTime() < Date.parse(new Date().toISOString()) : false;

  async function pagar(tarjeta: DatosTarjetaBrick) {
    const r = await api<Resultado>("/api/v1/pagos/plan", { method: "POST", json: { plan: elegido, meses, claveIdem: clave, tarjeta } }).finally(() => setClave(crypto.randomUUID()));
    if (r.estado === "RECHAZADO") {
      toast.error(r.mensaje);
      throw new Error(r.mensaje);
    }
    toast.success(r.mensaje);
    setElegido(null);
    await recargar();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Mi plan y pagos</h1>
      <Estado cargando={cargando && !datos} error={error}>
        {datos && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Kpi etiqueta="Plan actual" valor={datos.plan.nombre} pista={datos.plan.precio ? `S/ ${datos.plan.precio} /mes` : "Sin costo"} />
              <Kpi etiqueta="Vigente hasta" valor={datos.venceAt ? new Date(datos.venceAt).toLocaleDateString("es-PE") : "—"} tono={vencido ? "mal" : "default"} pista={vencido ? "Vencido: renueva para mantener los módulos" : undefined} />
              <Kpi etiqueta="Pagos aprobados" valor={datos.pagos.filter((p) => p.estado === "APROBADO").length} />
            </div>

            <Seccion titulo="Cambiar o renovar plan" descripcion="El pago se hace aquí mismo con tarjeta de crédito o débito, procesado por Mercado Pago.">
              {!datos.pagosHabilitados && <p className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Los pagos con tarjeta no están configurados en el servidor (MERCADOPAGO_ACCESS_TOKEN).</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                {datos.planes.filter((p) => p.precio > 0).map((p) => (
                  <button key={p.codigo} type="button" aria-pressed={elegido === p.codigo} onClick={() => setElegido(p.codigo)} className={`rounded-2xl border p-4 text-left ${elegido === p.codigo ? "border-2 border-teal-600 bg-teal-50" : ""}`}>
                    <p className="font-semibold">{p.nombre} {p.codigo === datos.plan.codigo && <span className="text-xs text-teal-700">(actual · renovar)</span>}</p>
                    <p className="text-2xl font-bold">S/ {p.precio}<span className="text-sm font-normal text-muted-foreground"> /mes</span></p>
                    {p.modulos.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Módulos: {p.modulos.join(", ")}</p>}
                  </button>
                ))}
              </div>
              {plan && (
                <div className="mt-4 space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <label htmlFor="meses" className="text-sm font-medium">Meses</label>
                    <select id="meses" value={meses} onChange={(e) => setMeses(Number(e.target.value))} className="h-10 rounded-lg border bg-background px-3">
                      {[1, 3, 6, 12].map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <p className="ml-auto text-xl font-bold">Total: S/ {monto.toFixed(2)}</p>
                  </div>
                  <TarjetaMercadoPago key={`${plan.codigo}-${meses}`} monto={monto} onPagar={pagar} deshabilitado={!datos.pagosHabilitados} />
                  <Button variant="ghost" onClick={() => setElegido(null)}>Cancelar</Button>
                </div>
              )}
            </Seccion>

            <Seccion titulo="Historial de pagos">
              <Tabla
                columnas={["Fecha", "Plan", "Meses", "Monto", "Tarjeta", "Estado"]}
                filas={datos.pagos.map((p) => [fmtFechaHora(p.fecha), p.plan, p.meses, `S/ ${p.monto.toFixed(2)}`, p.ultimos4 ? `${p.metodo ?? ""} •••• ${p.ultimos4}` : "—", <span key="e" title={p.detalle ?? ""}>{ESTADO[p.estado] ?? p.estado}</span>])}
                vacio="Aún no hay pagos registrados."
              />
            </Seccion>
          </>
        )}
      </Estado>
    </div>
  );
}
