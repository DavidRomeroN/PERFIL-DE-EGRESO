"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BellRing, Check, CheckCheck, Clock, Copy, Loader2, MapPin, MessageCircle, QrCode, Share2, Users, Volume2, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/fetcher";
import { ESTADO_CLASS, ESTADO_LABEL, fmtHora } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TurnoPublico } from "@/lib/turnos";
import { useRealtime } from "@/hooks/use-realtime";
import { useSonido } from "@/hooks/use-sonido";

type Turno = Omit<TurnoPublico, "emitidoAt" | "avisadoAt" | "llamadoAt" | "finalizadoAt" | "notificaciones"> & {
  emitidoAt: string;
  avisadoAt: string | null;
  llamadoAt: string | null;
  finalizadoAt: string | null;
  notificaciones: { id: number; tipo: string; destino: string | null; mensaje: string; estado: string; enviadoAt: string | null; createdAt: string }[];
};

export function MiTurno({ inicial }: { inicial: Turno }) {
  const [turno, setTurno] = useState<Turno>(inicial);
  const [cancelando, setCancelando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [sonidoOn, setSonidoOn] = useState(false);
  const { timbre, vibrar, hablar } = useSonido();
  const estadoPrevio = useRef(inicial.estado);

  const refrescar = useCallback(async () => {
    try {
      const t = await api<Turno>(`/api/v1/public/turnos/${inicial.token}`);
      setTurno(t);
    } catch {
      /* ignorar */
    }
  }, [inicial.token]);

  const conexion = useRealtime(turno.local.slug, (e) => {
    if (e.tipo === "turno:estado" && e.turno.token === turno.token) void refrescar();
    else if (e.tipo === "turno:llamado") void refrescar();
    else if (e.tipo === "cola:actualizada" && (!e.colaId || e.colaId === turno.cola.id)) void refrescar();
    else if (e.tipo === "notificacion:nueva" && e.notificacion.turnoId === turno.id) void refrescar();
  });

  // Respaldo: refresco periódico por si el SSE se corta
  useEffect(() => {
    const id = setInterval(refrescar, 15000);
    return () => clearInterval(id);
  }, [refrescar]);

  // Efectos al ser llamado
  useEffect(() => {
    if (turno.estado === "LLAMADO" && estadoPrevio.current !== "LLAMADO") {
      vibrar();
      if (sonidoOn) {
        timbre();
        hablar(`Turno ${turno.codigo.split("").join(" ")}. Acércate a ${turno.ventanilla?.nombre ?? "la ventanilla"}.`);
      }
      toast.success(`¡Es tu turno! Acércate a ${turno.ventanilla?.nombre ?? "la ventanilla"}`, { duration: 10000 });
    }
    if (turno.estado === "AVISADO" && estadoPrevio.current === "EMITIDO") {
      vibrar();
      if (sonidoOn) timbre();
    }
    estadoPrevio.current = turno.estado;
  }, [turno.estado, turno.codigo, turno.ventanilla, sonidoOn, timbre, hablar, vibrar]);

  async function cancelar() {
    setCancelando(true);
    try {
      const t = await api<Turno>(`/api/v1/public/turnos/${turno.token}`, { method: "DELETE" });
      setTurno(t);
      toast.success("Turno cancelado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cancelar");
    } finally {
      setCancelando(false);
      setConfirmar(false);
    }
  }

  async function compartir() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: `Turno ${turno.codigo}`, text: `Mi turno ${turno.codigo} en ${turno.local.nombreComercial}`, url });
        return;
      } catch {
        /* cancelado */
      }
    }
    await navigator.clipboard.writeText(url);
    toast.success("Enlace copiado");
  }

  const activo = turno.estado === "EMITIDO" || turno.estado === "AVISADO";
  const llamado = turno.estado === "LLAMADO";
  const finalizado = !activo && !llamado;
  const color = turno.local.colorPrimario;
  const progreso = activo ? Math.max(8, Math.round(100 - (turno.personasDelante / (turno.personasDelante + 3)) * 100)) : 100;

  return (
    <div className="flex min-h-screen flex-col bg-muted/30" style={{ ["--local" as string]: color }}>
      <header className="text-white" style={{ background: `linear-gradient(135deg, ${color}, color-mix(in oklch, ${color} 70%, black))` }}>
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-5 pb-10 pt-5">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-white/70">Tu turno en</p>
            <h1 className="truncate text-lg font-semibold">{turno.local.nombreComercial}</h1>
            {turno.local.direccion && <p className="flex items-center gap-1 truncate text-xs text-white/80"><MapPin className="size-3" /> {turno.local.direccion}</p>}
          </div>
          <span className={cn("size-2.5 shrink-0 rounded-full", conexion === "conectado" ? "bg-emerald-300" : "bg-amber-300 animate-pulse")} title={conexion === "conectado" ? "En vivo" : "Reconectando"} />
        </div>
      </header>

      <main className="mx-auto -mt-6 w-full max-w-lg flex-1 space-y-4 px-4 pb-10">
        {/* Tarjeta principal */}
        <section className={cn("relative overflow-hidden rounded-3xl border bg-card p-6 text-center shadow-lg", llamado && "animate-flash-call ring-4 ring-[var(--local)]")}>
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-muted-foreground">{turno.cola.nombre}</span>
            <Badge className={cn("border", ESTADO_CLASS[turno.estado])}>{ESTADO_LABEL[turno.estado]}</Badge>
          </div>

          <p className="mt-6 font-mono text-7xl font-bold tracking-tight sm:text-8xl" style={{ color }}>
            {turno.codigo}
          </p>

          {activo && (
            <>
              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-muted/60 p-3">
                  <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground"><Users className="size-3.5" /> Delante de ti</p>
                  <p className="mt-1 text-3xl font-bold tabular">{turno.personasDelante}</p>
                  <p className="text-xs text-muted-foreground">{turno.personasDelante === 1 ? "persona" : "personas"}</p>
                </div>
                <div className="rounded-2xl bg-muted/60 p-3">
                  <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground"><Clock className="size-3.5" /> Espera aprox.</p>
                  <p className="mt-1 text-3xl font-bold tabular">{turno.tiempoEstimadoSeg < 60 ? "<1" : Math.round(turno.tiempoEstimadoSeg / 60)}</p>
                  {turno.prediccion && <p className="text-xs text-muted-foreground">Rango habitual {turno.prediccion.p50Min}–{turno.prediccion.p90Min} min</p>}
                  <p className="text-xs text-muted-foreground">minutos</p>
                </div>
              </div>
              <div className="mt-5">
                <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${progreso}%`, background: color }} />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {turno.personasDelante === 0 ? "Eres el siguiente. Acércate a la sala." : `Posición ${turno.posicion} en la cola · puedes salir, te avisamos cuando falten ${turno.local.avisarFaltando}.`}
                </p>
              </div>
            </>
          )}

          {llamado && (
            <div className="mt-6 rounded-2xl p-5 text-white" style={{ background: color }}>
              <p className="flex items-center justify-center gap-2 text-sm font-medium uppercase tracking-wider"><BellRing className="size-4" /> ¡Es tu turno!</p>
              <p className="mt-2 text-3xl font-bold">{turno.ventanilla?.nombre ?? "Ventanilla"}</p>
              <p className="mt-1 text-sm text-white/85">Acércate ahora. {turno.rellamadas > 0 && `Te llamaron ${turno.rellamadas + 1} veces.`}</p>
            </div>
          )}

          {finalizado && (
            <div className="mt-6 rounded-2xl bg-muted/60 p-5">
              {turno.estado === "ATENDIDO" && <><Check className="mx-auto size-10 text-emerald-600" /><p className="mt-2 font-semibold">Gracias por tu visita</p><p className="text-sm text-muted-foreground">Atendido en {turno.ventanilla?.nombre} a las {fmtHora(turno.finalizadoAt)}.</p>
                <Valoracion token={turno.token} /></>}
              {turno.estado === "CANCELADO" && <><XCircle className="mx-auto size-10 text-zinc-500" /><p className="mt-2 font-semibold">Turno cancelado</p><p className="text-sm text-muted-foreground">Puedes tomar uno nuevo cuando quieras.</p></>}
              {turno.estado === "NO_SE_PRESENTO" && <><X className="mx-auto size-10 text-rose-600" /><p className="mt-2 font-semibold">Tu turno venció</p><p className="text-sm text-muted-foreground">Te llamaron en {turno.ventanilla?.nombre} y el tiempo de presentación terminó.</p></>}
              <Button asChild className="mt-4" variant="outline">
                <Link href={`/l/${turno.local.slug}`}><QrCode className="size-4" /> Tomar otro turno</Link>
              </Button>
            </div>
          )}

          <p className="mt-5 text-xs text-muted-foreground">Emitido a las {fmtHora(turno.emitidoAt)} · {turno.canal === "QR" ? "por QR" : "ticket impreso"}</p>
        </section>

        {/* Llamando ahora */}
        {(activo || llamado) && turno.llamandoAhora.length > 0 && (
          <section className="rounded-3xl border bg-card p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Llamando ahora en {turno.cola.nombre}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {turno.llamandoAhora.map((l) => (
                <span key={l.codigo} className="inline-flex items-center gap-2 rounded-xl border bg-muted/50 px-3 py-1.5 text-sm">
                  <span className="font-mono font-bold" style={{ color }}>{l.codigo}</span>
                  <span className="text-muted-foreground">→ {l.ventanilla}</span>
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Avisos (simulación visual del WhatsApp) */}
        {turno.notificaciones.length > 0 && (
          <section className="rounded-3xl border bg-card p-4 shadow-sm">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <MessageCircle className="size-3.5 text-emerald-600" /> Avisos enviados {turno.cliente.telefonoMasc && <span className="normal-case tracking-normal">· {turno.cliente.telefonoMasc}</span>}
            </p>
            <div className="mt-3 space-y-2 rounded-2xl bg-[#ece5dd] p-3">
              {turno.notificaciones.map((n) => (
                <div key={n.id} className="ml-auto max-w-[92%] rounded-2xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-sm text-emerald-950 shadow-sm">
                  <p className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: n.mensaje.replace(/\*(.+?)\*/g, "<b>$1</b>").replace(/(https?:\/\/\S+)/g, '<span class="text-sky-700 underline break-all">$1</span>') }} />
                  <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-emerald-800/70">
                    {n.tipo === "WHATSAPP" ? "WhatsApp" : "Aviso web"} · {fmtHora(n.createdAt)}
                    {n.estado === "PENDIENTE" && <Loader2 className="size-3 animate-spin" />}
                    {n.estado === "ENVIADO" && <Check className="size-3" />}
                    {n.estado === "ENTREGADO" && <CheckCheck className="size-3" />}
                    {n.estado === "LEIDO" && <CheckCheck className="size-3 text-sky-600" />}
                    {n.estado === "FALLIDO" && <X className="size-3 text-rose-600" />}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Acciones */}
        <section className="grid grid-cols-2 gap-3">
          <Button variant="outline" className="h-12 rounded-2xl" onClick={compartir}>
            <Share2 className="size-4" /> Compartir
          </Button>
          <Button
            variant="outline"
            className={cn("h-12 rounded-2xl", sonidoOn && "border-[var(--local)] text-[var(--local)]")}
            onClick={() => {
              setSonidoOn((v) => !v);
              if (!sonidoOn) timbre();
            }}
          >
            <Volume2 className="size-4" /> {sonidoOn ? "Sonido activado" : "Activar sonido"}
          </Button>
          {activo && (
            <Button variant="ghost" className="col-span-2 h-12 rounded-2xl text-rose-700 hover:bg-rose-50 hover:text-rose-800" onClick={() => setConfirmar(true)}>
              <XCircle className="size-4" /> Cancelar mi turno
            </Button>
          )}
        </section>

        <p className="flex items-center justify-center gap-1 text-center text-xs text-muted-foreground">
          <Copy className="size-3" /> Guarda este enlace para seguir tu turno · <Link href="/" className="font-medium underline-offset-2 hover:underline">TurnoYa</Link>
        </p>
      </main>

      <Dialog open={confirmar} onOpenChange={setConfirmar}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Cancelar el turno {turno.codigo}?</DialogTitle>
            <DialogDescription>Perderás tu lugar en la cola. Si cambias de opinión tendrás que tomar un turno nuevo.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmar(false)}>Volver</Button>
            <Button variant="destructive" onClick={cancelar} disabled={cancelando}>
              {cancelando && <Loader2 className="size-4 animate-spin" />} Sí, cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Valoracion({ token }: { token: string }) {
  const [estrellas, setEstrellas] = useState(5);
  const [enviada, setEnviada] = useState(false);
  if (enviada) return <p className="mt-3 text-sm text-emerald-700">Gracias por tu valoración.</p>;
  return (
    <form className="mt-4 space-y-2" onSubmit={async (e) => {
      e.preventDefault();
      try {
        await api(`/api/v1/public/turnos/${token}/valoracion`, { method: "POST", json: { estrellas } });
        setEnviada(true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo guardar");
      }
    }}>
      <p className="text-sm font-medium">¿Cómo fue la atención?</p>
      <div className="flex justify-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button type="button" key={n} onClick={() => setEstrellas(n)} className={cn("text-2xl", n <= estrellas ? "text-amber-500" : "text-muted-foreground")}>★</button>
        ))}
      </div>
      <Button type="submit" variant="outline" className="w-full">Enviar valoración</Button>
    </form>
  );
}
