"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Link2, Loader2, LogOut, Power, QrCode, RefreshCw, Send, Smartphone, Webhook, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { api } from "@/lib/fetcher";
import { cn } from "@/lib/utils";

interface Estado {
  proveedor: string;
  configurado: boolean;
  url: string;
  sesion: string;
  alcanzable: boolean;
  estado: string;
  telefono: string | null;
  nombre: string | null;
  qr: string | null;
  error: string | null;
  webhookRegistrado: boolean;
  webhookUrl: string;
}

const LABEL: Record<string, { texto: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  ready: { texto: "Conectado", tone: "ok" },
  qr_ready: { texto: "Escanea el código QR", tone: "warn" },
  initializing: { texto: "Iniciando…", tone: "warn" },
  authenticating: { texto: "Autenticando…", tone: "warn" },
  created: { texto: "Sesión creada (sin iniciar)", tone: "muted" },
  disconnected: { texto: "Desconectado", tone: "bad" },
  action_required: { texto: "Requiere acción en el teléfono", tone: "warn" },
  failed: { texto: "Error en la sesión", tone: "bad" },
  sin_sesion: { texto: "Sin vincular", tone: "muted" },
  sin_configurar: { texto: "OpenWA no configurado", tone: "muted" },
};

export function ConexionOpenWA() {
  const [st, setSt] = useState<Estado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [accion, setAccion] = useState<string | null>(null);
  const [telPrueba, setTelPrueba] = useState("");
  const [confirmarDesvincular, setConfirmarDesvincular] = useState(false);

  const cargar = useCallback(async (silencioso = true) => {
    if (!silencioso) setCargando(true);
    try {
      setSt(await api<Estado>("/api/v1/whatsapp/conexion"));
    } catch (e) {
      if (!silencioso) toast.error(e instanceof Error ? e.message : "No se pudo consultar OpenWA");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Mientras se espera el escaneo del QR o la inicialización, refrescar seguido.
  const transitorio = st && ["qr_ready", "initializing", "authenticating"].includes(st.estado);
  useEffect(() => {
    if (!st?.configurado) return;
    const id = setInterval(() => void cargar(), transitorio ? 4000 : 20000);
    return () => clearInterval(id);
  }, [st?.configurado, transitorio, cargar]);

  async function ejecutar(a: "iniciar" | "webhook" | "detener" | "desvincular" | "prueba") {
    setAccion(a);
    try {
      const r = await api<Estado & { enviado?: boolean }>("/api/v1/whatsapp/conexion", { method: "POST", json: { accion: a, telefono: telPrueba || undefined } });
      setSt(r);
      const msgs: Record<typeof a, string> = {
        iniciar: r.estado === "ready" ? "Sesión conectada" : "Sesión iniciada: escanea el QR con WhatsApp",
        webhook: "Webhook de estados registrado en OpenWA",
        detener: "Sesión detenida",
        desvincular: "Número desvinculado",
        prueba: "Mensaje de prueba enviado",
      };
      toast.success(msgs[a]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setAccion(null);
    }
  }

  const info = LABEL[st?.estado ?? "sin_configurar"] ?? { texto: st?.estado ?? "—", tone: "muted" as const };
  const toneClass = { ok: "bg-emerald-100 text-emerald-800", warn: "bg-amber-100 text-amber-900", bad: "bg-rose-100 text-rose-800", muted: "bg-slate-100 text-slate-700" }[info.tone];

  return (
    <section className="rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
        <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-600 text-white"><Smartphone className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Número de WhatsApp (OpenWA)</h2>
          <p className="truncate text-xs text-muted-foreground">
            Gateway open source auto-hospedado · {st?.url ?? "…"} · sesión <span className="font-mono">{st?.sesion ?? "turnoya"}</span>
          </p>
        </div>
        <span className={cn("inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold", toneClass)}>
          {info.tone === "ok" ? <CheckCircle2 className="size-3.5" /> : info.tone === "bad" ? <WifiOff className="size-3.5" /> : info.tone === "warn" ? <Loader2 className="size-3.5 animate-spin" /> : <Power className="size-3.5" />}
          {info.texto}
        </span>
        <Button variant="ghost" size="icon-sm" title="Actualizar" onClick={() => cargar(false)} disabled={cargando}>
          <RefreshCw className={cn("size-4", cargando && "animate-spin")} />
        </Button>
      </div>

      {st === null ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Consultando OpenWA…</div>
      ) : !st.configurado ? (
        <div className="p-5 text-sm">
          <p className="flex items-start gap-2 text-amber-900"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> Define <code className="rounded bg-muted px-1">OPENWA_API_KEY</code> (y opcionalmente <code className="rounded bg-muted px-1">OPENWA_URL</code>) en el archivo <code className="rounded bg-muted px-1">.env</code>, levanta el gateway con <code className="rounded bg-muted px-1">docker compose --profile whatsapp up -d</code> y pon <code className="rounded bg-muted px-1">WHATSAPP_PROVIDER=openwa</code>.</p>
        </div>
      ) : !st.alcanzable ? (
        <div className="p-5 text-sm">
          <p className="flex items-start gap-2 text-rose-800"><WifiOff className="mt-0.5 size-4 shrink-0" /> No se pudo conectar con OpenWA en <span className="font-mono">{st.url}</span>. {st.error && <span className="text-muted-foreground">({st.error})</span>}</p>
          <p className="mt-2 text-muted-foreground">Inicia el gateway: <code className="rounded bg-muted px-1">docker compose --profile whatsapp up -d openwa</code> y vuelve a intentar.</p>
          <Button className="mt-3" variant="outline" size="sm" onClick={() => cargar(false)}><RefreshCw className="size-4" /> Reintentar</Button>
        </div>
      ) : (
        <div className="grid gap-5 p-5 md:grid-cols-[220px_1fr]">
          {/* QR / estado visual */}
          <div className="flex flex-col items-center justify-center rounded-2xl border bg-muted/30 p-3">
            {st.estado === "qr_ready" && st.qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={st.qr} alt="Código QR para vincular WhatsApp" className="size-48 rounded-lg bg-white p-1" />
            ) : st.estado === "ready" ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <CheckCircle2 className="size-12 text-emerald-600" />
                <p className="font-semibold">{st.nombre ?? "WhatsApp"}</p>
                <p className="font-mono text-sm text-muted-foreground">{st.telefono ? `+${st.telefono}` : ""}</p>
              </div>
            ) : transitorio ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center text-muted-foreground">
                <Loader2 className="size-10 animate-spin" />
                <p className="text-sm">{info.texto}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-6 text-center text-muted-foreground">
                <QrCode className="size-12" />
                <p className="text-sm">Inicia la sesión para generar el QR</p>
              </div>
            )}
          </div>

          <div className="space-y-4 text-sm">
            {st.estado === "qr_ready" && (
              <ol className="list-decimal space-y-1 rounded-xl bg-amber-50 p-3 pl-7 text-amber-950">
                <li>Abre WhatsApp en el celular del local (usa un número dedicado, no el personal).</li>
                <li>Menú <b>⋮</b> → <b>Dispositivos vinculados</b> → <b>Vincular un dispositivo</b>.</li>
                <li>Escanea el código. En unos segundos aparecerá como <b>Conectado</b>.</li>
              </ol>
            )}
            {st.error && st.estado !== "qr_ready" && <p className="rounded-xl bg-rose-50 p-3 text-rose-800">{st.error}</p>}

            <div className="flex flex-wrap gap-2">
              {st.estado !== "ready" && !transitorio && (
                <Button onClick={() => ejecutar("iniciar")} disabled={!!accion}>
                  {accion === "iniciar" ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />} {st.estado === "sin_sesion" ? "Vincular número" : "Iniciar sesión"}
                </Button>
              )}
              {(st.estado === "ready" || transitorio) && (
                <Button variant="outline" onClick={() => ejecutar("detener")} disabled={!!accion}>
                  {accion === "detener" ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />} Detener
                </Button>
              )}
              {st.estado !== "sin_sesion" && (
                <Button variant="ghost" className="text-rose-600" onClick={() => setConfirmarDesvincular(true)} disabled={!!accion}>
                  <LogOut className="size-4" /> Desvincular
                </Button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
              <Webhook className={cn("size-4", st.webhookRegistrado ? "text-emerald-600" : "text-muted-foreground")} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">Webhook de estados {st.webhookRegistrado ? <Badge variant="success" className="ml-1">activo</Badge> : <Badge variant="outline" className="ml-1">no registrado</Badge>}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{st.webhookUrl}</p>
              </div>
              {!st.webhookRegistrado && st.estado !== "sin_sesion" && (
                <Button size="sm" variant="outline" onClick={() => ejecutar("webhook")} disabled={!!accion}>
                  {accion === "webhook" ? <Loader2 className="size-4 animate-spin" /> : <Webhook className="size-4" />} Registrar
                </Button>
              )}
            </div>

            {st.estado === "ready" && (
              <div className="flex flex-wrap items-center gap-2">
                <Input value={telPrueba} onChange={(e) => setTelPrueba(e.target.value)} placeholder="Celular de prueba (951234567)" inputMode="tel" className="w-56" />
                <Button variant="secondary" onClick={() => ejecutar("prueba")} disabled={!!accion || telPrueba.replace(/\D/g, "").length < 9}>
                  {accion === "prueba" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Enviar prueba
                </Button>
              </div>
            )}

            {st.proveedor !== "openwa" && (
              <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-amber-900">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                El proveedor activo es <b className="mx-1">{st.proveedor}</b>: los avisos de turno aún no salen por este número. Cambia <code className="mx-1 rounded bg-white/70 px-1">WHATSAPP_PROVIDER=openwa</code> y reinicia la app.
              </p>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmarDesvincular}
        onOpenChange={setConfirmarDesvincular}
        title="¿Desvincular el número de WhatsApp?"
        description="Se cerrará la sesión en OpenWA y tendrás que volver a escanear el QR para enviar avisos."
        confirmLabel="Desvincular"
        destructive
        onConfirm={() => {
          setConfirmarDesvincular(false);
          void ejecutar("desvincular");
        }}
      />
    </section>
  );
}
