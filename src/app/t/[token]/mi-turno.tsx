"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { BellRing, Check, CheckCheck, Clock, Copy, Loader2, MessageCircle, QrCode, Share2, Users, Volume2, VolumeX, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CabeceraLocal } from "@/components/app/cabecera-local";
import { CheckAnimado, EnVivo, Numero } from "@/components/app/motion";
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

const EASE = [0.23, 1, 0.32, 1] as const;

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

  // M6: si el turno fue transferido, el enlace lleva al turno sucesor
  useEffect(() => {
    if (turno.estado === "TRANSFERIDO" && turno.redirigidoA) window.location.replace(`/t/${turno.redirigidoA.token}`);
  }, [turno.estado, turno.redirigidoA]);

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
      toast.success(`Es tu turno. Acércate a ${turno.ventanilla?.nombre ?? "la ventanilla"}`, { duration: 10000 });
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
  const fase = activo ? "espera" : llamado ? "llamado" : "fin";
  const color = turno.local.colorPrimario;
  const progreso = activo ? Math.max(8, Math.round(100 - (turno.personasDelante / (turno.personasDelante + 3)) * 100)) : 100;
  const minutos = turno.tiempoEstimadoSeg < 60 ? 0 : Math.round(turno.tiempoEstimadoSeg / 60);

  return (
    <div className="flex min-h-dvh flex-col bg-muted/40" style={{ ["--local" as string]: color }}>
      <CabeceraLocal local={turno.local} sobretitulo="Tu turno en">
        <EnVivo estado={conexion} oscuro etiqueta={false} className="shrink-0 rounded-full bg-white/10 p-2 backdrop-blur" />
      </CabeceraLocal>

      <main className="relative mx-auto -mt-6 w-full max-w-lg flex-1 space-y-4 px-4 pb-10">
        {/* Ticket principal */}
        <section className={cn("relative animate-enter-soft rounded-3xl bg-card text-center shadow-float ring-1 ring-foreground/5 transition-shadow duration-500", llamado && "animate-flash-call ring-4 ring-[var(--local)]")}>
          <div className="px-6 pb-6 pt-5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-muted-foreground">{turno.cola.nombre}</span>
              <Badge key={turno.estado} className={cn("animate-pop border", ESTADO_CLASS[turno.estado])}>{ESTADO_LABEL[turno.estado]}</Badge>
            </div>
            <p className="mt-5 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Tu número</p>
            <p className="mt-1 font-mono text-7xl font-bold tracking-tight sm:text-8xl" style={{ color }}>
              {turno.codigo}
            </p>
          </div>

          {/* Troquel del ticket */}
          <div className="relative h-0 border-t-2 border-dashed border-border" aria-hidden>
            <span className="absolute -left-3 top-1/2 size-6 -translate-y-1/2 rounded-full bg-background">
              <span className="absolute inset-0 rounded-full bg-muted/40" />
            </span>
            <span className="absolute -right-3 top-1/2 size-6 -translate-y-1/2 rounded-full bg-background">
              <span className="absolute inset-0 rounded-full bg-muted/40" />
            </span>
          </div>

          <div className="px-6 pb-5 pt-6">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={fase} initial={{ opacity: 0, y: 10, filter: "blur(3px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -6, filter: "blur(3px)" }} transition={{ duration: 0.3, ease: EASE }}>
                {activo && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-2xl bg-muted/60 p-3">
                        <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground"><Users className="size-3.5" /> Delante de ti</p>
                        <p className="mt-1 text-4xl font-semibold tracking-tight"><Numero valor={turno.personasDelante} /></p>
                        <p className="text-xs text-muted-foreground">{turno.personasDelante === 1 ? "persona" : "personas"}</p>
                      </div>
                      <div className="rounded-2xl bg-muted/60 p-3">
                        <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground"><Clock className="size-3.5" /> Espera aprox.</p>
                        <p className="mt-1 text-4xl font-semibold tracking-tight">{minutos === 0 ? "<1" : <Numero valor={minutos} />}</p>
                        <p className="text-xs text-muted-foreground">minutos</p>
                        {turno.prediccion && <p className="mt-0.5 text-[11px] text-muted-foreground">{turno.prediccion.enfrio ? "Estimación inicial" : `Entre ${Math.max(1, Math.round(turno.prediccion.loSeg / 60))} y ${Math.max(1, Math.round(turno.prediccion.hiSeg / 60))} min (${Math.round(turno.prediccion.confianza * 100)} %)`}</p>}
                      </div>
                    </div>
                    <div className="mt-5">
                      <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progreso} aria-valuemin={0} aria-valuemax={100} aria-label="Avance en la cola">
                        <div className="h-full origin-left rounded-full transition-transform duration-700 ease-out" style={{ transform: `scaleX(${progreso / 100})`, background: `linear-gradient(90deg, color-mix(in oklch, ${color} 70%, white), ${color})` }} />
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {turno.personasDelante === 0 ? "Eres el siguiente. Acércate a la sala." : `Posición ${turno.posicion} en la cola · puedes salir, te avisamos cuando falten ${turno.local.avisarFaltando}.`}
                      </p>
                    </div>
                    {turno.prediccion && <AvisoYMejoresHoras token={turno.token} colaId={turno.cola.id} aviso={turno.avisoMinAntes} onCambio={refrescar} />}
                  </>
                )}

                {llamado && (
                  <div className="animate-pulse-ring rounded-2xl p-5 text-white shadow-lifted" style={{ background: `linear-gradient(135deg, ${color}, color-mix(in oklch, ${color} 70%, black))` }}>
                    <p className="flex items-center justify-center gap-2 text-sm font-medium uppercase tracking-[0.14em]">
                      <BellRing className="size-4 origin-top animate-campana" /> Es tu turno
                    </p>
                    <p className="mt-2 text-3xl font-bold tracking-tight">{turno.ventanilla?.nombre ?? "Ventanilla"}</p>
                    <p className="mt-1 text-sm text-white/85">Acércate ahora. {turno.rellamadas > 0 && `Te llamaron ${turno.rellamadas + 1} veces.`}</p>
                  </div>
                )}

                {finalizado && (
                  <div className="flex flex-col items-center rounded-2xl bg-muted/50 p-5">
                    {turno.estado === "ATENDIDO" && (
                      <>
                        <CheckAnimado />
                        <p className="mt-3 font-semibold">Gracias por tu visita</p>
                        <p className="text-sm text-muted-foreground">Atendido en {turno.ventanilla?.nombre} a las {fmtHora(turno.finalizadoAt)}</p>
                        <Valoracion token={turno.token} />
                      </>
                    )}
                    {turno.estado === "CANCELADO" && (
                      <>
                        <span className="flex size-14 animate-pop items-center justify-center rounded-full bg-zinc-100 text-zinc-500 ring-8 ring-zinc-50"><XCircle className="size-7" /></span>
                        <p className="mt-3 font-semibold">Turno cancelado</p>
                        <p className="text-sm text-muted-foreground">Puedes tomar uno nuevo cuando quieras.</p>
                      </>
                    )}
                    {turno.estado === "NO_SE_PRESENTO" && (
                      <>
                        <span className="flex size-14 animate-pop items-center justify-center rounded-full bg-rose-100 text-rose-600 ring-8 ring-rose-50"><X className="size-7" /></span>
                        <p className="mt-3 font-semibold">Tu turno venció</p>
                        <p className="text-sm text-muted-foreground">Te llamaron en {turno.ventanilla?.nombre} y el tiempo de presentación terminó.</p>
                      </>
                    )}
                    <Button asChild className="mt-4" variant="outline">
                      <Link href={`/l/${turno.local.slug}`}><QrCode className="size-4" /> Tomar otro turno</Link>
                    </Button>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            <p className="mt-5 text-xs text-muted-foreground">Emitido a las {fmtHora(turno.emitidoAt)} · {turno.canal === "QR" ? "por QR" : "ticket impreso"}</p>
          </div>
        </section>

        {/* Llamando ahora */}
        {(activo || llamado) && turno.llamandoAhora.length > 0 && (
          <section className="animate-enter rounded-3xl border bg-card p-4 shadow-soft [animation-delay:120ms]">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Llamando ahora en {turno.cola.nombre}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <AnimatePresence mode="popLayout" initial={false}>
                {turno.llamandoAhora.map((l) => (
                  <motion.span
                    key={l.codigo}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.25, ease: EASE }}
                    className="inline-flex items-center gap-2 rounded-xl border bg-muted/50 px-3 py-1.5 text-sm"
                  >
                    <span className="font-mono font-bold" style={{ color }}>{l.codigo}</span>
                    <span className="text-muted-foreground">→ {l.ventanilla}</span>
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>
          </section>
        )}

        {/* Avisos (simulación visual del WhatsApp) */}
        {turno.notificaciones.length > 0 && (
          <section className="animate-enter rounded-3xl border bg-card p-4 shadow-soft [animation-delay:180ms]">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              <MessageCircle className="size-3.5 text-emerald-600" /> Avisos enviados {turno.cliente.telefonoMasc && <span className="normal-case tracking-normal">· {turno.cliente.telefonoMasc}</span>}
            </p>
            <div className="mt-3 space-y-2 overflow-hidden rounded-2xl bg-[#ece5dd] p-3">
              <AnimatePresence initial={false}>
                {turno.notificaciones.map((n) => (
                  <motion.div
                    key={n.id}
                    initial={{ opacity: 0, y: 12, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.35, ease: EASE }}
                    style={{ transformOrigin: "bottom right" }}
                    className="ml-auto max-w-[92%] rounded-2xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-sm text-emerald-950 shadow-sm"
                  >
                    <p className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: n.mensaje.replace(/\*(.+?)\*/g, "<b>$1</b>").replace(/(https?:\/\/\S+)/g, '<span class="text-sky-700 underline break-all">$1</span>') }} />
                    <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-emerald-800/70">
                      {n.tipo === "WHATSAPP" ? "WhatsApp" : "Aviso web"} · {fmtHora(n.createdAt)}
                      {n.estado === "PENDIENTE" && <Loader2 className="size-3 animate-spin" />}
                      {n.estado === "ENVIADO" && <Check className="size-3" />}
                      {n.estado === "ENTREGADO" && <CheckCheck className="size-3" />}
                      {n.estado === "LEIDO" && <CheckCheck className="size-3 text-sky-600 transition-colors duration-300" />}
                      {n.estado === "FALLIDO" && <X className="size-3 text-rose-600" />}
                    </p>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </section>
        )}

        {/* Acciones */}
        <section className="grid animate-enter grid-cols-2 gap-3 [animation-delay:220ms]">
          <Button variant="outline" className="h-12 rounded-2xl" onClick={compartir}>
            <Share2 className="size-4" /> Compartir
          </Button>
          <Button
            variant="outline"
            aria-pressed={sonidoOn}
            className={cn("h-12 rounded-2xl", sonidoOn && "border-[var(--local)] text-[var(--local)]")}
            onClick={() => {
              setSonidoOn((v) => !v);
              if (!sonidoOn) timbre();
            }}
          >
            {sonidoOn ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />} {sonidoOn ? "Sonido activado" : "Activar sonido"}
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
  if (enviada) return <p className="mt-3 animate-pop text-sm font-medium text-emerald-700">Gracias por tu valoración.</p>;
  return (
    <form
      className="mt-4 w-full space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api(`/api/v1/public/turnos/${token}/valoracion`, { method: "POST", json: { estrellas } });
          setEnviada(true);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "No se pudo guardar");
        }
      }}
    >
      <p className="text-sm font-medium">¿Cómo fue la atención?</p>
      <div className="flex justify-center gap-1" role="radiogroup" aria-label="Valoración">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            type="button"
            key={n}
            role="radio"
            aria-checked={n === estrellas}
            aria-label={`${n} de 5`}
            onClick={() => setEstrellas(n)}
            className={cn("p-0.5 text-3xl leading-none transition-[color,scale] duration-200 ease-out hover:scale-110 active:scale-95", n <= estrellas ? "text-amber-400" : "text-muted-foreground/40")}
            style={{ transitionDelay: n <= estrellas ? `${(n - 1) * 30}ms` : "0ms" }}
          >
            ★
          </button>
        ))}
      </div>
      <Button type="submit" variant="outline" className="w-full">Enviar valoración</Button>
    </form>
  );
}

/** M2 · "Avisarme X min antes" (opt-in) y mejores horas para venir. */
function AvisoYMejoresHoras({ token, colaId, aviso, onCambio }: { token: string; colaId: number; aviso: number | null; onCambio: () => void }) {
  const [horas, setHoras] = useState<{ franja: string; esperaMin: number; nivel: string }[]>([]);
  const grupo = useId();
  useEffect(() => {
    api<typeof horas>(`/api/v1/public/colas/${colaId}/mejores-horas`).then(setHoras).catch(() => {});
  }, [colaId]);
  return (
    <div className="mt-5 space-y-3 text-left">
      <div className="rounded-2xl border p-3">
        <p className="text-sm font-medium">Avisarme cuando falten</p>
        <div className="mt-2 flex gap-1 rounded-xl bg-muted/70 p-1" role="group" aria-label="Aviso por tiempo">
          {[null, 5, 10, 15].map((m) => {
            const activo = aviso === m;
            return (
              <button
                key={String(m)}
                type="button"
                aria-pressed={activo}
                onClick={() => api(`/api/v1/public/turnos/${token}/aviso`, { method: "PATCH", json: { minAntes: m } }).then(onCambio).catch(() => {})}
                className={cn("relative min-h-10 flex-1 rounded-lg text-sm font-medium text-muted-foreground transition-colors duration-200", activo && "text-background")}
              >
                {activo && <motion.span layoutId={grupo} className="absolute inset-0 rounded-lg bg-foreground shadow-sm" transition={{ type: "spring", duration: 0.35, bounce: 0.12 }} aria-hidden />}
                <span className="relative">{m ? `${m} min` : "No"}</span>
              </button>
            );
          })}
        </div>
      </div>
      {horas.length > 0 && (
        <div className="animate-enter rounded-2xl border p-3">
          <p className="text-sm font-medium">Mejores horas para venir hoy</p>
          <ul className="mt-2 flex flex-wrap gap-2 text-xs">
            {horas.slice(0, 8).map((h, i) => (
              <li key={h.franja} style={{ ["--i" as string]: i }} className={cn("animate-pop stagger rounded-lg px-2 py-1", h.nivel === "baja" ? "bg-emerald-100 text-emerald-800" : h.nivel === "alta" ? "bg-rose-100 text-rose-800" : "bg-muted")}>
                {h.franja} · ~{h.esperaMin} min
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
