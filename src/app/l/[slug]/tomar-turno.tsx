"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Clock, Loader2, MapPin, MessageCircle, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogoMark } from "@/components/brand/logo";
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

export function TomarTurno({ local, colas: colasIniciales }: { local: LocalInfo; colas: ColaInfo[] }) {
  const router = useRouter();
  const [colas, setColas] = useState(colasIniciales);
  const [paso, setPaso] = useState<1 | 2>(colasIniciales.length === 1 ? 2 : 1);
  const [cola, setCola] = useState<ColaInfo | null>(colasIniciales.length === 1 ? colasIniciales[0] : null);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [consentimiento, setConsentimiento] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [duplicado, setDuplicado] = useState<{ token: string; codigo: string } | null>(null);

  // Mantener actualizados los contadores de espera
  useRealtime(local.slug, async (e) => {
    if (e.tipo === "cola:actualizada") {
      try {
        const d = await api<{ colas: ColaInfo[] }>(`/api/v1/public/locales/${local.slug}`);
        setColas(d.colas);
      } catch {
        /* ignorar */
      }
    }
  });

  const quiereWhatsApp = telefono.trim().length > 0;

  async function enviar() {
    if (!cola) return;
    if (quiereWhatsApp && !consentimiento) {
      toast.error("Acepta la política de datos para recibir el aviso por WhatsApp");
      return;
    }
    setEnviando(true);
    setDuplicado(null);
    try {
      const turno = await api<TurnoPublico>("/api/v1/public/turnos", {
        method: "POST",
        json: { colaId: cola.id, nombre: nombre || null, telefono: telefono || null, consentimiento },
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
    <div className="flex min-h-screen flex-col bg-muted/30" style={{ ["--local" as string]: local.colorPrimario }}>
      {/* Cabecera del local */}
      <header className="text-white" style={{ background: `linear-gradient(135deg, ${local.colorPrimario}, color-mix(in oklch, ${local.colorPrimario} 70%, black))` }}>
        <div className="mx-auto flex max-w-lg items-center gap-3 px-5 pb-8 pt-6">
          {local.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={local.logoUrl} alt="" className="size-12 rounded-xl bg-white/90 object-contain p-1" />
          ) : (
            <LogoMark className="bg-white/20 from-white/30 to-white/10" />
          )}
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-white/70">{local.rubro}</p>
            <h1 className="truncate text-xl font-semibold">{local.nombreComercial}</h1>
            {local.direccion && (
              <p className="flex items-center gap-1 truncate text-xs text-white/80">
                <MapPin className="size-3" /> {local.direccion}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto -mt-4 w-full max-w-lg flex-1 px-4 pb-10">
        <div className="rounded-3xl border bg-card p-5 shadow-lg">
          {/* Indicador de pasos */}
          <div className="mb-5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className={cn("flex size-6 items-center justify-center rounded-full", paso >= 1 ? "bg-[var(--local)] text-white" : "bg-muted")}>{paso > 1 ? <Check className="size-3.5" /> : "1"}</span>
            Servicio
            <span className="h-px flex-1 bg-border" />
            <span className={cn("flex size-6 items-center justify-center rounded-full", paso >= 2 ? "bg-[var(--local)] text-white" : "bg-muted")}>2</span>
            Tus datos
          </div>

          {paso === 1 && (
            <section>
              <h2 className="text-2xl font-semibold tracking-tight">¿Qué servicio necesitas?</h2>
              <p className="mt-1 text-sm text-muted-foreground">{local.mensajeBienvenida ?? "Elige una cola para tomar tu turno."}</p>
              <div className="mt-5 grid gap-3">
                {colas.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setCola(c);
                      setPaso(2);
                    }}
                    className="group flex items-center gap-4 rounded-2xl border bg-background p-4 text-left transition hover:border-[var(--local)] hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/40"
                  >
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-xl font-mono text-xl font-bold text-white" style={{ background: local.colorPrimario }}>
                      {c.prefijo}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-lg font-semibold leading-tight">{c.nombre}</span>
                      {c.descripcion && <span className="block truncate text-sm text-muted-foreground">{c.descripcion}</span>}
                      <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><Users className="size-3.5" /> {c.enEspera} en espera</span>
                        <span className="inline-flex items-center gap-1"><Clock className="size-3.5" /> ~ {fmtDuracion(c.tiempoEstimadoSeg)}</span>
                      </span>
                    </span>
                    <ArrowRight className="size-5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-[var(--local)]" />
                  </button>
                ))}
                {colas.length === 0 && <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Este local no tiene colas activas por el momento.</p>}
              </div>
            </section>
          )}

          {paso === 2 && cola && (
            <section>
              {colas.length > 1 && (
                <button type="button" onClick={() => setPaso(1)} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="size-4" /> Cambiar servicio
                </button>
              )}
              <div className="flex items-center gap-3 rounded-2xl bg-muted/60 p-3">
                <span className="flex size-10 items-center justify-center rounded-lg font-mono text-lg font-bold text-white" style={{ background: local.colorPrimario }}>{cola.prefijo}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-tight">{cola.nombre}</p>
                  <p className="text-xs text-muted-foreground">{cola.enEspera} en espera · espera aprox. {fmtDuracion(cola.tiempoEstimadoSeg)}</p>
                </div>
              </div>

              <h2 className="mt-5 text-2xl font-semibold tracking-tight">Tus datos</h2>
              <p className="mt-1 text-sm text-muted-foreground">Son opcionales. Con tu celular te avisamos por WhatsApp cuando falten {local.avisarFaltando} personas.</p>

              <div className="mt-5 space-y-4">
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

                <label className={cn("flex cursor-pointer items-start gap-3 rounded-2xl border p-3 text-sm transition", consentimiento ? "border-[var(--local)] bg-accent/40" : "hover:bg-muted/50", !quiereWhatsApp && "opacity-70")}>
                  <input type="checkbox" checked={consentimiento} onChange={(e) => setConsentimiento(e.target.checked)} className="mt-0.5 size-5 accent-[var(--local)]" />
                  <span>
                    <span className="inline-flex items-center gap-1 font-medium"><ShieldCheck className="size-4" /> Acepto la política de datos</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Usaremos tu nombre y celular solo para avisarte de tu turno. Se eliminan a los 90 días (Ley N.° 29733). Puedes cancelar tu turno cuando quieras.
                    </span>
                  </span>
                </label>

                {duplicado && (
                  <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                    <p className="font-semibold">Este celular ya tiene el turno {duplicado.codigo} activo en esta cola.</p>
                    <Button asChild variant="warning" className="mt-3 w-full">
                      <Link href={`/t/${duplicado.token}`}>Ver mi turno {duplicado.codigo}</Link>
                    </Button>
                  </div>
                )}

                <Button size="xl" className="w-full" style={{ background: local.colorPrimario }} onClick={enviar} disabled={enviando}>
                  {enviando ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" />}
                  {enviando ? "Generando tu turno…" : "Tomar mi turno"}
                </Button>
                <p className="text-center text-xs text-muted-foreground">Sin app, sin registro. En menos de 3 segundos.</p>
              </div>
            </section>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Fila virtual por <Link href="/" className="font-medium underline-offset-2 hover:underline">TurnoYa</Link>
        </p>
      </main>
    </div>
  );
}
