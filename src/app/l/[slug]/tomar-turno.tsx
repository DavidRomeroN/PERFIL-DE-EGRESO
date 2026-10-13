"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Clock, Loader2, MessageCircle, MoonStar, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CabeceraLocal } from "@/components/app/cabecera-local";
import { Numero } from "@/components/app/motion";
import { api, ApiError } from "@/lib/fetcher";
import { fmtDuracion } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TurnoPublico } from "@/lib/turnos";
import { useRealtime } from "@/hooks/use-realtime";

interface ColaInfo {
  id: number;
  prefijo: string;
  nombre: string;
  descripcion: string | null;
  enEspera: number;
  tiempoEstimadoSeg: number;
}

interface LocalInfo {
  slug: string;
  nombreComercial: string;
  rubro: string;
  direccion: string | null;
  colorPrimario: string;
  logoUrl: string | null;
  mensajeBienvenida: string | null;
  avisarFaltando: number;
  whatsappHabilitado: boolean;
}

const EASE = [0.23, 1, 0.32, 1] as const;

export function TomarTurno({
  local,
  colas: colasIniciales,
  categorias = [],
  aviso = null,
  citasHref = null,
}: {
  local: LocalInfo;
  colas: ColaInfo[];
  categorias?: { codigo: string; nombre: string }[];
  aviso?: string | null;
  citasHref?: string | null;
}) {
  const router = useRouter();
  const [colas, setColas] = useState(colasIniciales);
  const [paso, setPaso] = useState<1 | 2>(colasIniciales.length === 1 ? 2 : 1);
  // Dirección del último cambio de paso: adelante entra desde la derecha, atrás desde la izquierda
  const [direccion, setDireccion] = useState<1 | -1>(1);
  const [cola, setCola] = useState<ColaInfo | null>(colasIniciales.length === 1 ? colasIniciales[0] : null);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [consentimiento, setConsentimiento] = useState(false);
  const [categoria, setCategoria] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [errorConsentimiento, setErrorConsentimiento] = useState(0);
  const [duplicado, setDuplicado] = useState<{ token: string; codigo: string } | null>(null);

  // Mantener actualizados los contadores de espera
  useRealtime(local.slug, async (e) => {
    if (e.tipo === "cola:actualizada") {
      try {
        const d = await api<{ colas: ColaInfo[] }>(`/api/v1/public/locales/${local.slug}`);
        setColas(d.colas);
        setCola((actual) => (actual ? (d.colas.find((c) => c.id === actual.id) ?? actual) : actual));
      } catch {
        /* ignorar */
      }
    }
  });

  const quiereWhatsApp = telefono.trim().length > 0;

  function irA(p: 1 | 2) {
    setDireccion(p > paso ? 1 : -1);
    setPaso(p);
  }

  async function enviar() {
    if (!cola) return;
    if (quiereWhatsApp && !consentimiento) {
      setErrorConsentimiento((n) => n + 1);
      toast.error("Acepta la política de datos para recibir el aviso por WhatsApp");
      return;
    }
    setEnviando(true);
    setDuplicado(null);
    try {
      const turno = await api<TurnoPublico>("/api/v1/public/turnos", {
        method: "POST",
        json: { colaId: cola.id, nombre: nombre || null, telefono: telefono || null, consentimiento, categoriaCodigo: categoria || null },
      });
      toast.success(`Tu turno es ${turno.codigo}`);
      router.push(`/t/${turno.token}`);
    } catch (e) {
      if (e instanceof ApiError && e.codigo === "TURNO_DUPLICADO") {
        setDuplicado({ token: String(e.extra?.token), codigo: String(e.extra?.codigo) });
      } else {
        toast.error(e instanceof Error ? e.message : "No se pudo tomar el turno");
      }
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30" style={{ ["--local" as string]: local.colorPrimario }}>
      <CabeceraLocal local={local} />

      <main className="relative mx-auto -mt-6 w-full max-w-lg flex-1 px-4 pb-10">
        <div className="animate-enter-soft overflow-hidden rounded-3xl border bg-card p-5 shadow-float [animation-delay:60ms]">
          {aviso && (
            <p role="status" className="mb-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <MoonStar className="mt-0.5 size-4 shrink-0" /> {aviso}
            </p>
          )}

          {/* Indicador de pasos: la línea se llena al avanzar */}
          <div className="mb-5 flex items-center gap-2 text-xs font-medium text-muted-foreground" aria-label={`Paso ${paso} de 2`}>
            <span className={cn("flex size-6 items-center justify-center rounded-full text-white transition-colors duration-300", "bg-[var(--local)]")}>
              {paso > 1 ? <Check className="size-3.5 animate-pop" /> : "1"}
            </span>
            <span className={cn("transition-colors duration-300", paso === 1 && "text-foreground")}>Servicio</span>
            <span className="relative h-0.5 flex-1 overflow-hidden rounded-full bg-border">
              <span className="absolute inset-0 origin-left bg-[var(--local)] transition-transform duration-500 ease-out" style={{ transform: `scaleX(${paso > 1 ? 1 : 0})` }} />
            </span>
            <span className={cn("flex size-6 items-center justify-center rounded-full transition-colors delay-200 duration-300", paso >= 2 ? "bg-[var(--local)] text-white" : "bg-muted")}>2</span>
            <span className={cn("transition-colors duration-300", paso === 2 && "text-foreground")}>Tus datos</span>
          </div>

          <AnimatePresence mode="popLayout" initial={false} custom={direccion}>
            {paso === 1 && (
              <motion.section
                key="paso-1"
                custom={direccion}
                variants={{ entra: (d: number) => ({ opacity: 0, x: d * 28 }), centro: { opacity: 1, x: 0 }, sale: (d: number) => ({ opacity: 0, x: d * -28 }) }}
                initial="entra"
                animate="centro"
                exit="sale"
                transition={{ duration: 0.32, ease: EASE }}
              >
                <h2 className="text-2xl font-semibold tracking-tight">¿Qué servicio necesitas?</h2>
                <p className="mt-1 text-sm text-muted-foreground">{local.mensajeBienvenida ?? "Elige una cola para tomar tu turno."}</p>
                <div className="mt-5 grid grid-cols-1 gap-3">
                  {colas.map((c, i) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setCola(c);
                        irA(2);
                      }}
                      style={{ ["--i" as string]: i }}
                      className="press lift group flex animate-enter stagger items-center gap-4 rounded-2xl border bg-background p-4 text-left hover:border-[var(--local)]/60 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                    >
                      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl font-mono text-xl font-bold text-white shadow-sm transition-transform duration-300 ease-out group-hover:scale-105" style={{ background: local.colorPrimario }}>
                        {c.prefijo}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-lg font-semibold leading-tight">{c.nombre}</span>
                        {c.descripcion && <span className="block truncate text-sm text-muted-foreground">{c.descripcion}</span>}
                        <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Users className="size-3.5" /> <Numero valor={c.enEspera} /> en espera
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Clock className="size-3.5" /> ~ {fmtDuracion(c.tiempoEstimadoSeg)}
                          </span>
                        </span>
                      </span>
                      <ArrowRight className="size-5 shrink-0 text-muted-foreground transition-[translate,color] duration-200 ease-out group-hover:translate-x-1 group-hover:text-[var(--local)]" />
                    </button>
                  ))}
                  {colas.length === 0 && <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Este local no tiene colas activas por el momento.</p>}
                </div>
              </motion.section>
            )}

            {paso === 2 && cola && (
              <motion.section
                key="paso-2"
                custom={direccion}
                variants={{ entra: (d: number) => ({ opacity: 0, x: d * 28 }), centro: { opacity: 1, x: 0 }, sale: (d: number) => ({ opacity: 0, x: d * -28 }) }}
                initial="entra"
                animate="centro"
                exit="sale"
                transition={{ duration: 0.32, ease: EASE }}
              >
                {colas.length > 1 && (
                  <button type="button" onClick={() => irA(1)} className="group mb-3 inline-flex items-center gap-1 rounded-lg text-sm text-muted-foreground transition-colors hover:text-foreground">
                    <ArrowLeft className="size-4 transition-transform duration-200 ease-out group-hover:-translate-x-0.5" /> Cambiar servicio
                  </button>
                )}
                <div className="flex items-center gap-3 rounded-2xl bg-muted/60 p-3 ring-1 ring-border/60">
                  <span className="flex size-10 items-center justify-center rounded-lg font-mono text-lg font-bold text-white shadow-sm" style={{ background: local.colorPrimario }}>
                    {cola.prefijo}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold leading-tight">{cola.nombre}</p>
                    <p className="text-xs text-muted-foreground">
                      <Numero valor={cola.enEspera} /> en espera · espera aprox. {fmtDuracion(cola.tiempoEstimadoSeg)}
                    </p>
                  </div>
                </div>

                <h2 className="mt-5 text-2xl font-semibold tracking-tight">Tus datos</h2>
                <p className="mt-1 text-sm text-muted-foreground">Son opcionales. Con tu celular te avisamos por WhatsApp cuando falten {local.avisarFaltando} personas.</p>

                <div className="mt-5 space-y-4">
                  {categorias.length > 0 && (
                    <div className="space-y-1.5">
                      <Label htmlFor="prioridad" className="text-base">Atención preferente (opcional)</Label>
                      <select id="prioridad" value={categoria} onChange={(e) => setCategoria(e.target.value)} className="h-12 w-full rounded-xl border bg-background px-3 text-base shadow-xs transition-[border-color,box-shadow] duration-200 outline-none hover:border-foreground/20 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40">
                        <option value="">Turno general</option>
                        {categorias.map((c) => (
                          <option key={c.codigo} value={c.codigo}>{c.nombre}</option>
                        ))}
                      </select>
                      <p className="text-xs text-muted-foreground">El personal puede pedir un documento. En la pantalla pública solo se ve tu número.</p>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="nombre" className="text-base">Nombre (opcional)</Label>
                    <Input id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. María" className="h-12 text-lg" autoComplete="given-name" maxLength={60} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="telefono" className="text-base">
                      <MessageCircle className="size-4 text-emerald-600" /> Celular para WhatsApp (opcional)
                    </Label>
                    <Input
                      id="telefono"
                      type="tel"
                      inputMode="numeric"
                      value={telefono}
                      onChange={(e) => setTelefono(e.target.value.replace(/[^\d+\s]/g, ""))}
                      placeholder="9XX XXX XXX"
                      className="h-12 text-lg tracking-wide"
                      autoComplete="tel"
                      maxLength={15}
                    />
                    {!local.whatsappHabilitado && <p className="text-xs text-amber-700">Este local está en el plan Gratis: el aviso llegará solo por esta página web.</p>}
                  </div>

                  <label
                    key={errorConsentimiento}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-2xl border p-3 text-sm transition-[background-color,border-color,opacity] duration-200",
                      consentimiento ? "border-[var(--local)] bg-[color-mix(in_oklch,var(--local)_7%,transparent)]" : "hover:bg-muted/50",
                      !quiereWhatsApp && "opacity-70",
                      errorConsentimiento > 0 && !consentimiento && "animate-shake border-rose-300",
                    )}
                  >
                    <input type="checkbox" checked={consentimiento} onChange={(e) => setConsentimiento(e.target.checked)} className="mt-0.5 size-5 accent-[var(--local)]" />
                    <span>
                      <span className="inline-flex items-center gap-1 font-medium"><ShieldCheck className="size-4" /> Acepto la política de datos</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        Usaremos tu nombre y celular solo para avisarte de tu turno. Se eliminan a los 90 días (Ley N.° 29733). Puedes cancelar tu turno cuando quieras.
                      </span>
                    </span>
                  </label>

                  <AnimatePresence initial={false}>
                    {duplicado && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.28, ease: EASE }} className="overflow-hidden">
                        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                          <p className="font-semibold">Este celular ya tiene el turno {duplicado.codigo} activo en esta cola.</p>
                          <Button asChild variant="warning" className="mt-3 w-full">
                            <Link href={`/t/${duplicado.token}`}>Ver mi turno {duplicado.codigo}</Link>
                          </Button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <Button size="xl" className="relative w-full overflow-hidden" style={{ background: local.colorPrimario }} onClick={enviar} disabled={enviando}>
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.span
                        key={enviando ? "enviando" : "listo"}
                        initial={{ opacity: 0, y: 12, filter: "blur(2px)" }}
                        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                        exit={{ opacity: 0, y: -12, filter: "blur(2px)" }}
                        transition={{ duration: 0.22, ease: EASE }}
                        className="inline-flex items-center gap-2"
                      >
                        {enviando ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" />}
                        {enviando ? "Generando tu turno…" : "Tomar mi turno"}
                      </motion.span>
                    </AnimatePresence>
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">Sin app, sin registro. En menos de 3 segundos.</p>
                </div>
              </motion.section>
            )}
          </AnimatePresence>
        </div>

        {citasHref && (
          <Link href={citasHref} className="press lift mt-4 flex animate-enter items-center gap-3 rounded-2xl border bg-card p-4 text-sm shadow-soft [animation-delay:160ms] hover:border-[var(--local)]/50">
            <span className="flex size-9 items-center justify-center rounded-xl bg-muted text-[var(--local)]">
              <CalendarDays className="size-4.5" />
            </span>
            <span className="flex-1">
              <span className="block font-medium">¿Prefieres reservar un horario?</span>
              <span className="block text-xs text-muted-foreground">Agenda una cita y llega a tu hora</span>
            </span>
            <ArrowRight className="size-4 text-muted-foreground" />
          </Link>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Fila virtual por <Link href="/" className="font-medium underline-offset-2 hover:underline">TurnoYa</Link>
        </p>
      </main>
    </div>
  );
}
