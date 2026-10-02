"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, CheckCheck, Clock, Globe, Loader2, MessageCircle, Send, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, StatCard, EmptyState } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/fetcher";
import { fmtFechaHora } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useRealtime } from "@/hooks/use-realtime";
import { ConexionOpenWA } from "./conexion-openwa";

const PROVEEDOR_LABEL: Record<string, { texto: string; variant: "success" | "warning" | "default" }> = {
  meta: { texto: "WhatsApp Cloud API (Meta) conectado", variant: "success" },
  openwa: { texto: "Gateway OpenWA (número propio)", variant: "default" },
  mock: { texto: "Modo simulador: los mensajes no salen a WhatsApp real", variant: "warning" },
};

interface Notif {
  id: number;
  tipo: "WHATSAPP" | "WEB";
  destino: string | null;
  mensaje: string;
  plantilla: string | null;
  estado: "PENDIENTE" | "ENVIADO" | "ENTREGADO" | "LEIDO" | "FALLIDO";
  error: string | null;
  createdAt: string;
  turno: { codigo: string; token: string; estado: string; cola: { nombre: string }; cliente: { nombre: string | null } | null };
}

const ICONO = {
  PENDIENTE: <Clock className="size-3.5 text-muted-foreground" />,
  ENVIADO: <Check className="size-3.5 text-muted-foreground" />,
  ENTREGADO: <CheckCheck className="size-3.5 text-muted-foreground" />,
  LEIDO: <CheckCheck className="size-3.5 text-sky-600" />,
  FALLIDO: <X className="size-3.5 text-rose-600" />,
};

export function NotificacionesAdmin({ slug, proveedor, whatsappHabilitado, maxAvisos }: { slug: string; proveedor: string; whatsappHabilitado: boolean; maxAvisos: number }) {
  const [data, setData] = useState<{ notificaciones: Notif[]; resumen: Record<string, number> } | null>(null);

  const cargar = useCallback(async () => {
    try {
      setData(await api("/api/v1/notificaciones?limit=80"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  }, []);
  useEffect(() => void cargar(), [cargar]);
  useRealtime(slug, (e) => {
    if (e.tipo === "notificacion:nueva") void cargar();
  });

  const r = data?.resumen ?? {};
  const enviados = (r.ENVIADO ?? 0) + (r.ENTREGADO ?? 0) + (r.LEIDO ?? 0);
  const total = enviados + (r.FALLIDO ?? 0) + (r.PENDIENTE ?? 0);
  const tasaEntrega = total ? Math.round((((r.ENTREGADO ?? 0) + (r.LEIDO ?? 0)) / total) * 100) : 0;

  return (
    <div>
      <PageHeader title="Avisos por WhatsApp" description="Mensajes automáticos enviados con la plantilla turno_proximo cuando faltan pocas personas, y turno_llamado al llamar.">
        <Badge variant={(PROVEEDOR_LABEL[proveedor] ?? PROVEEDOR_LABEL.mock).variant} className="rounded-lg px-2.5 py-1">
          {(PROVEEDOR_LABEL[proveedor] ?? PROVEEDOR_LABEL.mock).texto}
        </Badge>
      </PageHeader>

      {proveedor !== "meta" && (
        <div className="mb-6">
          <ConexionOpenWA />
        </div>
      )}

      {!whatsappHabilitado && (
        <div className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Este local está en el plan <b>Gratis</b>: los avisos se muestran solo en la web del cliente (RN05). Mejora al plan Emprende o Pro para activar WhatsApp.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Mensajes WhatsApp" value={total} hint={`Plan: ${maxAvisos.toLocaleString("es-PE")} avisos/mes`} icon={MessageCircle} />
        <StatCard label="Entregados o leídos" value={`${tasaEntrega}%`} hint="Meta ≥ 95 %" icon={CheckCheck} tone={tasaEntrega >= 95 ? "good" : "warn"} />
        <StatCard label="Leídos" value={r.LEIDO ?? 0} icon={Check} tone="good" />
        <StatCard label="Fallidos" value={r.FALLIDO ?? 0} hint="Reintentos automáticos" icon={X} tone={(r.FALLIDO ?? 0) > 0 ? "bad" : "default"} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="rounded-2xl border bg-card shadow-sm">
          <div className="border-b px-5 py-4">
            <h2 className="font-semibold">Bandeja de salida</h2>
            <p className="text-xs text-muted-foreground">Se actualiza en tiempo real cuando el proveedor confirma la entrega (webhook): enviado → entregado → leído.</p>
          </div>
          {data === null ? (
            <div className="flex items-center gap-2 p-6 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Cargando…</div>
          ) : data.notificaciones.length === 0 ? (
            <div className="p-6"><EmptyState icon={Send} title="Aún no se envió ningún aviso" description="Cuando una cola avance y falten pocas personas, aparecerán aquí." /></div>
          ) : (
            <ul className="divide-y">
              {data.notificaciones.map((n) => (
                <li key={n.id} className="flex gap-3 px-5 py-3">
                  <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", n.tipo === "WHATSAPP" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600")}>
                    {n.tipo === "WHATSAPP" ? <MessageCircle className="size-4" /> : <Globe className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className="font-mono font-semibold">{n.turno.codigo}</span>
                      <span className="text-muted-foreground">{n.turno.cola.nombre}</span>
                      {n.destino && <span className="font-mono text-xs text-muted-foreground">{n.destino}</span>}
                      {n.plantilla && <Badge variant="outline" className="font-mono text-[10px]">{n.plantilla}</Badge>}
                      <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">{ICONO[n.estado]} {n.estado.toLowerCase()} · {fmtFechaHora(n.createdAt)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-foreground/80" dangerouslySetInnerHTML={{ __html: n.mensaje.replace(/\*(.+?)\*/g, "<b>$1</b>") }} />
                    {n.error && <p className="mt-1 text-xs text-rose-600">{n.error}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <h3 className="font-semibold">Plantillas aprobadas</h3>
            <div className="mt-3 space-y-3 text-sm">
              <div className="rounded-xl bg-[#e7f6ec] p-3 text-emerald-950">
                <p className="font-mono text-[10px] text-emerald-700">turno_proximo</p>
                <p className="mt-1">Hola {"{{1}}"} 👋, tu turno <b>{"{{2}}"}</b> en <b>{"{{3}}"}</b> está por llegar: faltan {"{{4}}"} personas. Acércate a la sala. Sigue tu turno aquí: {"{{5}}"}</p>
              </div>
              <div className="rounded-xl bg-[#e7f6ec] p-3 text-emerald-950">
                <p className="font-mono text-[10px] text-emerald-700">turno_llamado</p>
                <p className="mt-1">📣 <b>{"{{1}}"}</b>, es tu turno en <b>{"{{2}}"}</b>. Acércate a <b>{"{{3}}"}</b>.</p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border bg-card p-5 text-sm shadow-sm">
            <h3 className="font-semibold">Cómo funciona</h3>
            <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-muted-foreground">
              <li>El cliente deja su celular y acepta la política de datos (opt-in).</li>
              <li>Cuando faltan N personas (configurable), se encola el envío.</li>
              <li>Se envía por el proveedor activo (OpenWA, Meta Cloud API o simulador) y se guarda el <i>message id</i>.</li>
              <li>El proveedor notifica por webhook: enviado → entregado → leído.</li>
              <li>El teléfono se guarda cifrado y se elimina a los 90 días.</li>
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}
