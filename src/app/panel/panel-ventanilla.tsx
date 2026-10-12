"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BellRing,
  Check,
  ChevronRight,
  Clock,
  LayoutDashboard,
  Loader2,
  MessageCircle,
  Monitor,
  PhoneForwarded,
  Printer,
  Ticket,
  Timer,
  Users,
  UserX,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { Logo } from "@/components/brand/logo";
import { UserMenu } from "@/components/app/user-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/fetcher";
import { ESTADO_CLASS, ESTADO_LABEL, fmtDuracion, fmtHora, haceCuanto } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Session } from "@/lib/auth";
import type { SnapshotLocal, TurnoPublico } from "@/lib/turnos";
import { useRealtime } from "@/hooks/use-realtime";
import { useSonido } from "@/hooks/use-sonido";
import { PanelModulos } from "./panel-modulos";

type Snap = SnapshotLocal;

export function PanelVentanilla({ session, slug, locales }: { session: Session; slug: string; locales: { slug: string; nombreComercial: string }[] }) {
  const router = useRouter();
  const [snap, setSnap] = useState<Snap | null>(null);
  const [ventanillaSel, setVentanillaId] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [ticketCola, setTicketCola] = useState<number | null>(null);
  const [ticketNombre, setTicketNombre] = useState("");
  const [ahora, setAhora] = useState(() => Date.now());
  const { timbre } = useSonido();
  const esAdmin = session.rol !== "OPERADOR";
  const localQuery = session.rol === "SUPER_ADMIN" ? `?slug=${slug}` : "";

  const refrescar = useCallback(async () => {
    try {
      const s = await api<Snap>(`/api/v1/panel/estado${localQuery}`);
      setSnap(s);
      // Ventanilla persistida por dispositivo (solo si aún no hay selección)
      setVentanillaId((actual) => {
        if (actual !== null) return actual;
        const guardada = Number(localStorage.getItem(`turnoya:ventanilla:${slug}`));
        return s.ventanillas.find((v) => v.id === guardada)?.id ?? null;
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cargar el panel");
    }
  }, [localQuery, slug]);

  const conexion = useRealtime(slug, (e) => {
    if (e.tipo === "cola:actualizada" || e.tipo === "turno:estado" || e.tipo === "turno:llamado") void refrescar();
    if (e.tipo === "notificacion:nueva") void refrescar();
  });

  useEffect(() => {
    void refrescar();
    const id = setInterval(() => setAhora(Date.now()), 1000);
    const poll = setInterval(refrescar, 20000);
    return () => {
      clearInterval(id);
      clearInterval(poll);
    };
  }, [refrescar]);

  function elegirVentanilla(id: number) {
    setVentanillaId(id);
    localStorage.setItem(`turnoya:ventanilla:${slug}`, String(id));
    localStorage.setItem("turnoya:ventanilla-id", String(id));
  }

  // Ventanilla efectiva: la elegida (o la primera disponible si no hay selección)
  const ventanilla = (snap?.ventanillas.find((v) => v.id === ventanillaSel) ?? snap?.ventanillas[0]) ?? null;
  const ventanillaId = ventanilla?.id ?? null;
  const colasVisibles = useMemo(() => {
    if (!snap) return [];
    return ventanilla?.cola ? snap.colas.filter((c) => c.id === ventanilla.cola!.id) : snap.colas;
  }, [snap, ventanilla]);
  const espera = useMemo(() => colasVisibles.flatMap((c) => c.espera.map((t) => ({ ...t, cola: c.nombre, prefijo: c.prefijo }))).sort((a, b) => a.posicion - b.posicion), [colasVisibles]);
  const actual = useMemo(() => snap?.colas.flatMap((c) => c.llamados.map((l) => ({ ...l, cola: c.nombre, colaId: c.id }))).find((l) => l.ventanillaId === ventanillaId) ?? null, [snap, ventanillaId]);
  const segundosLlamado = actual?.llamadoAt ? Math.floor((ahora - new Date(actual.llamadoAt).getTime()) / 1000) : 0;
  const limiteAusencia = snap?.local.tiempoAusenciaSeg ?? 180;
  const excedido = segundosLlamado >= limiteAusencia; // RN04

  async function llamarSiguiente() {
    if (!ventanillaId) return toast.error("Elige una ventanilla");
    setOcupado(true);
    try {
      const r = await api<{ turno: TurnoPublico | null; vacia: boolean }>(`/api/v1/ventanillas/${ventanillaId}/llamar-siguiente${localQuery ? `?localId=${snap?.local.id}` : ""}`, { method: "POST" });
      if (r.vacia) toast.info("No hay turnos en espera");
      else {
        timbre();
        toast.success(`Llamando a ${r.turno?.codigo}`);
      }
      await refrescar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al llamar");
    } finally {
      setOcupado(false);
    }
  }

  async function cambiarEstado(id: number, estado: "ATENDIDO" | "NO_SE_PRESENTO" | "LLAMADO") {
    setOcupado(true);
    try {
      await api(`/api/v1/turnos/${id}/estado${localQuery ? `?localId=${snap?.local.id}` : ""}`, { method: "PATCH", json: { estado } });
      if (estado === "LLAMADO") {
        timbre();
        toast.success("Rellamando…");
      } else toast.success(estado === "ATENDIDO" ? "Marcado como atendido" : "Marcado como no se presentó");
      await refrescar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setOcupado(false);
    }
  }

  async function emitirTicket() {
    const colaId = ticketCola ?? colasVisibles[0]?.id;
    if (!colaId) return;
    setOcupado(true);
    try {
      const t = await api<TurnoPublico>("/api/v1/turnos/ticket", { method: "POST", json: { colaId, nombre: ticketNombre || null } });
      toast.success(`Ticket ${t.codigo} emitido`);
      setTicketOpen(false);
      setTicketNombre("");
      window.open(`/ticket/${t.token}`, "_blank", "width=420,height=640");
      await refrescar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo emitir el ticket");
    } finally {
      setOcupado(false);
    }
  }

  if (!snap) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" /> Cargando panel…
      </div>
    );
  }

  const color = snap.local.colorPrimario;

  return (
    <div className="flex min-h-screen flex-col bg-muted/30" style={{ ["--local" as string]: color }}>
      {/* Barra superior */}
      <header className="sticky top-0 z-30 border-b bg-card/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4">
          <div className="flex min-w-0 items-center gap-4">
            <Logo href={esAdmin ? "/admin" : "/panel"} />
            <span className="hidden h-6 w-px bg-border sm:block" />
            <div className="hidden min-w-0 sm:block">
              <p className="truncate text-sm font-semibold leading-tight">{snap.local.nombreComercial}</p>
              <p className="text-xs text-muted-foreground">Panel de ventanilla</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {locales.length > 1 && (
              <NativeSelect value={slug} onChange={(e) => router.push(`/panel?slug=${e.target.value}`)} className="h-9 w-44">
                {locales.map((l) => (
                  <option key={l.slug} value={l.slug}>{l.nombreComercial}</option>
                ))}
              </NativeSelect>
            )}
            <NativeSelect value={ventanillaId ?? ""} onChange={(e) => elegirVentanilla(Number(e.target.value))} className="h-9 w-44 font-medium">
              {snap.ventanillas.map((v) => (
                <option key={v.id} value={v.id}>{v.nombre}{v.cola ? ` · ${v.cola.prefijo}` : ""}</option>
              ))}
            </NativeSelect>
            <Button asChild variant="outline" size="icon-sm" title="Abrir pantalla TV">
              <Link href={`/l/${slug}/tv`} target="_blank"><Monitor className="size-4" /></Link>
            </Button>
            {esAdmin && (
              <Button asChild variant="outline" size="icon-sm" title="Administración">
                <Link href="/admin"><LayoutDashboard className="size-4" /></Link>
              </Button>
            )}
            <span className={cn("hidden items-center gap-1 rounded-lg border px-2 py-1 text-xs sm:inline-flex", conexion === "conectado" ? "text-emerald-700" : "text-amber-700")}>
              {conexion === "conectado" ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />} {conexion === "conectado" ? "En vivo" : "Reconectando"}
            </span>
            <UserMenu session={session} compact />
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-7xl flex-1 gap-6 p-4 lg:grid-cols-[1.1fr_0.9fr] lg:p-6">
        {/* ---------------- Columna de operación */}
        <section className="space-y-5">
          {/* Turno actual */}
          <div className={cn("relative overflow-hidden rounded-3xl border bg-card p-6 shadow-sm", actual && "ring-2 ring-[var(--local)]/40")}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{ventanilla?.nombre ?? "Ventanilla"} · turno actual</p>
              {actual && (
                <span className={cn("inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium tabular", excedido ? "bg-rose-100 text-rose-800" : "bg-muted text-muted-foreground")}>
                  <Timer className="size-3.5" /> {Math.floor(segundosLlamado / 60)}:{String(segundosLlamado % 60).padStart(2, "0")}
                </span>
              )}
            </div>

            {actual ? (
              <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center">
                <div className="text-center sm:text-left">
                  <p className="font-mono text-7xl font-bold leading-none tracking-tight" style={{ color }}>{actual.codigo}</p>
                  <p className="mt-2 text-lg font-medium">{actual.nombre ?? "Cliente sin nombre"}</p>
                  <p className="text-sm text-muted-foreground">{actual.cola} · llamado {fmtHora(actual.llamadoAt)}{actual.rellamadas > 0 && ` · ${actual.rellamadas} rellamada${actual.rellamadas > 1 ? "s" : ""}`}</p>
                  {excedido && (
                    <p className="mt-2 inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700">
                      <AlertTriangle className="size-3.5" /> Más de {Math.round(limiteAusencia / 60)} min sin presentarse (RN04). Puedes marcarlo como no se presentó.
                    </p>
                  )}
                </div>
                <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
                  <Button variant="success" size="lg" className="h-16 flex-col gap-0.5 rounded-2xl" disabled={ocupado} onClick={() => cambiarEstado(actual.id, "ATENDIDO")}>
                    <Check className="size-5" /> <span className="text-xs font-normal opacity-90">Atendido</span>
                  </Button>
                  <Button variant="outline" size="lg" className="h-16 flex-col gap-0.5 rounded-2xl" disabled={ocupado} onClick={() => cambiarEstado(actual.id, "LLAMADO")}>
                    <PhoneForwarded className="size-5" /> <span className="text-xs font-normal">Rellamar</span>
                  </Button>
                  <Button variant={excedido ? "destructive" : "outline"} size="lg" className={cn("h-16 flex-col gap-0.5 rounded-2xl", !excedido && "text-rose-700 hover:bg-rose-50")} disabled={ocupado} onClick={() => cambiarEstado(actual.id, "NO_SE_PRESENTO")}>
                    <UserX className="size-5" /> <span className="text-xs font-normal">No se presentó</span>
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed p-8 text-center text-muted-foreground">
                <BellRing className="mx-auto size-8 opacity-40" />
                <p className="mt-2">Ventanilla libre. Pulsa <b>Llamar siguiente</b> para atender al próximo turno.</p>
              </div>
            )}
          </div>

          {/* Botón principal */}
          <Button
            size="xl"
            className={cn("h-24 w-full rounded-3xl text-2xl shadow-lg", !ocupado && espera.length > 0 && "animate-pulse-ring")}
            style={{ background: color }}
            disabled={ocupado || !ventanillaId}
            onClick={llamarSiguiente}
          >
            {ocupado ? <Loader2 className="size-7 animate-spin" /> : <BellRing className="size-7" />}
            Llamar siguiente
            {espera[0] && <span className="ml-2 rounded-xl bg-white/20 px-3 py-1 font-mono text-xl">{espera[0].codigo}</span>}
          </Button>
          <p className="-mt-2 text-center text-xs text-muted-foreground">
            {actual ? "Al llamar al siguiente, el turno actual se marca como atendido automáticamente." : espera.length ? `${espera.length} en espera en ${ventanilla?.cola ? ventanilla.cola.nombre : "todas las colas"}` : "No hay nadie en espera"}
          </p>

          {/* Métricas del día */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { l: "En espera", v: snap.stats.enEspera, i: Users },
              { l: "Atendidos hoy", v: snap.stats.atendidos, i: Check },
              { l: "Espera prom.", v: `${snap.stats.esperaPromedioMin} min`, i: Clock },
              { l: "Abandono", v: `${snap.stats.tasaAbandono}%`, i: UserX },
            ].map((m) => (
              <div key={m.l} className="rounded-2xl border bg-card p-4">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><m.i className="size-3.5" /> {m.l}</p>
                <p className="mt-1 text-2xl font-bold tabular">{m.v}</p>
              </div>
            ))}
          </div>

          <PanelModulos
            localId={snap.local.id}
            colaId={ventanilla?.cola?.id ?? null}
            colas={snap.colas.map((c) => ({ id: c.id, nombre: c.nombre, enEspera: c.enEspera }))}
            actual={actual ? { id: actual.id, codigo: actual.codigo, colaId: actual.colaId } : null}
            espera={espera.map((t) => ({ id: t.id, codigo: t.codigo }))}
            onCambio={() => void refrescar()}
          />
        </section>

        {/* ---------------- Columna de cola */}
        <section className="flex flex-col gap-5">
          <div className="flex-1 rounded-3xl border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 className="font-semibold">Cola de espera</h2>
                <p className="text-xs text-muted-foreground">{ventanilla?.cola ? `${ventanilla.cola.nombre} (${ventanilla.cola.prefijo})` : "Todas las colas"} · {espera.length} turno{espera.length === 1 ? "" : "s"}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => { setTicketCola(colasVisibles[0]?.id ?? null); setTicketOpen(true); }}>
                <Ticket className="size-4" /> Ticket impreso
              </Button>
            </div>
            <ul className="max-h-[60vh] divide-y overflow-y-auto">
              {espera.length === 0 && <li className="p-8 text-center text-sm text-muted-foreground">Nadie en espera. ¡Buen trabajo!</li>}
              {espera.map((t, i) => {
                const esperaSeg = Math.floor((ahora - new Date(t.emitidoAt).getTime()) / 1000);
                return (
                  <li key={t.id} className={cn("flex items-center gap-3 px-5 py-3", i === 0 && "bg-accent/40")}>
                    <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold", i === 0 ? "text-white" : "bg-muted text-muted-foreground")} style={i === 0 ? { background: color } : undefined}>{i + 1}</span>
                    <span className="w-20 shrink-0 font-mono text-xl font-bold">{t.codigo}{t.codigoProvisional && <span className="block text-[10px] font-normal text-muted-foreground">({t.codigoProvisional})</span>}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{t.nombre ?? <span className="text-muted-foreground">Sin nombre</span>}{t.categoria ? <span className="ml-2 rounded bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-900">{t.categoria}</span> : null}</span>
                      {t.categoria && (
                        <span className="flex gap-1">
                          <button type="button" className="text-[10px] underline" onClick={() => api(`/api/v1/turnos/${t.id}/prioridad${localQuery}`, { method: "PATCH", json: { accion: "VERIFICAR" } }).then(() => toast.success("Prioridad verificada")).catch((e) => toast.error(e instanceof Error ? e.message : "Error"))}>Verificar</button>
                          <button type="button" className="text-[10px] underline" onClick={() => api(`/api/v1/turnos/${t.id}/prioridad${localQuery}`, { method: "PATCH", json: { accion: "RECHAZAR" } }).then(() => { toast.success("Pasó a turno general"); void refrescar(); }).catch((e) => toast.error(e instanceof Error ? e.message : "Error"))}>No corresponde</button>
                        </span>
                      )}
                      <span className="block truncate text-xs text-muted-foreground">{!ventanilla?.cola && `${t.cola} · `}{t.canal === "QR" ? "QR" : "Ticket"} · {fmtHora(t.emitidoAt)}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <Badge className={cn("border", ESTADO_CLASS[t.estado])}>{t.estado === "AVISADO" ? <><MessageCircle className="size-3" /> Avisado</> : ESTADO_LABEL[t.estado]}</Badge>
                      <span className="text-xs tabular text-muted-foreground">{fmtDuracion(esperaSeg)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Otras ventanillas */}
          <div className="rounded-3xl border bg-card p-5 shadow-sm">
            <h2 className="font-semibold">Ventanillas del local</h2>
            <ul className="mt-3 space-y-2">
              {snap.ventanillas.map((v) => {
                const en = snap.colas.flatMap((c) => c.llamados).find((l) => l.ventanillaId === v.id);
                return (
                  <li key={v.id} className={cn("flex items-center justify-between rounded-xl border px-3 py-2 text-sm", v.id === ventanillaId && "border-[var(--local)]/50 bg-accent/30")}>
                    <span className="font-medium">{v.nombre} <span className="text-xs text-muted-foreground">{v.cola ? `· ${v.cola.nombre}` : "· todas"}</span></span>
                    {en ? <span className="font-mono font-semibold" style={{ color }}>{en.codigo} <span className="text-xs font-normal text-muted-foreground">{haceCuanto(en.llamadoAt!)}</span></span> : <span className="text-xs text-muted-foreground">libre</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      </main>

      {/* Diálogo ticket */}
      <Dialog open={ticketOpen} onOpenChange={setTicketOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Printer className="size-4" /> Emitir ticket impreso</DialogTitle>
            <DialogDescription>Para clientes sin celular (RF07). El ticket incluye el número y un QR de seguimiento.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Cola</Label>
              <NativeSelect value={ticketCola ?? ""} onChange={(e) => setTicketCola(Number(e.target.value))}>
                {snap.colas.map((c) => (
                  <option key={c.id} value={c.id}>{c.prefijo} · {c.nombre} ({c.enEspera} en espera)</option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label>Nombre (opcional)</Label>
              <Input value={ticketNombre} onChange={(e) => setTicketNombre(e.target.value)} placeholder="Ej. Juan Pérez" maxLength={60} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTicketOpen(false)}>Cancelar</Button>
            <Button onClick={emitirTicket} disabled={ocupado}>
              {ocupado ? <Loader2 className="size-4 animate-spin" /> : <ChevronRight className="size-4" />} Emitir e imprimir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
