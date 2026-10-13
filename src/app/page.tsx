import Link from "next/link";
import { ArrowRight, ArrowUpRight, CheckCheck, QrCode, Tv } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Revelar } from "@/components/app/motion";
import { TicketVivo } from "@/components/landing/ticket-vivo";
import { PasosAcordeon } from "@/components/landing/pasos-acordeon";
import { IndiceSalidas } from "@/components/landing/indice-salidas";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/turnos";
import { soles } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const CUENTAS_DEMO = [
  ["Super admin TurnoYa", "superadmin@turnoya.pe", "admin123", "/admin/locales"],
  ["Admin · Policlínico", "admin@policlinico.pe", "admin123", "/admin"],
  ["Operador · Policlínico", "operador@policlinico.pe", "operador123", "/panel"],
  ["Admin · Transportes", "admin@transportes.pe", "admin123", "/admin"],
] as const;

/** Hueco del tamaño de una palabra dentro de un párrafo, con un control real del producto. */
function Ranura({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("mx-[0.12em] inline-flex h-[1em] w-[1.9em] items-center justify-center overflow-hidden rounded-[0.18em] align-[-0.12em] max-sm:w-[1.5em]", className)}>{children}</span>;
}

export default async function Home() {
  const [planes, locales, statsRaw] = await Promise.all([
    prisma.plan.findMany({ orderBy: { precioMensual: "asc" } }).catch(() => []),
    prisma.local.findMany({ where: { activo: true }, orderBy: { id: "asc" }, select: { slug: true, nombreComercial: true, rubro: true, direccion: true, colorPrimario: true } }).catch(() => []),
    prisma.turno.aggregate({ _count: { _all: true } }).catch(() => ({ _count: { _all: 0 } })),
  ]);
  const demo = locales[0];
  const totalTurnos = statsRaw._count._all;
  const gratis = planes.find((p) => Number(p.precioMensual) === 0);

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {/* ------------------------------------------------ Navegación: una sola línea compacta */}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-6">
          <Logo />
          <nav aria-label="Secciones" className="hidden items-center gap-8 text-[15px] text-muted-foreground md:flex">
            <a href="#como-funciona" className="transition-colors hover:text-foreground">Cómo funciona</a>
            <a href="#demo" className="transition-colors hover:text-foreground">Demo</a>
            <a href="#precios" className="transition-colors hover:text-foreground">Precios</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="max-sm:hidden">
              <Link href="/login">Ingresar</Link>
            </Button>
            {demo && (
              <Button asChild size="sm">
                <Link href={`/l/${demo.slug}`}>
                  Probar demo <ArrowRight className="size-4" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main id="contenido" className="flex-1">
        {/* ------------------------------------------------ Hero: titular a gritos y el ticket subiendo debajo */}
        <section className="relative flex h-[86svh] min-h-[620px] flex-col items-center overflow-hidden px-4 pt-[8vh] lg:h-[calc(100dvh-4rem)] lg:min-h-[680px]">
          <h1 className="relative z-10 text-center text-[clamp(3.4rem,10.5vw,10rem)] font-semibold leading-[0.9] tracking-[-0.045em]">
            <span className="linea"><span style={{ ["--i" as string]: 0 }}>Espera donde</span></span>
            <span className="linea"><span style={{ ["--i" as string]: 1 }} className="text-teal-600">quieras.</span></span>
          </h1>
          <div className="relative z-0 -mt-[1.2vw] aspect-[3/4] w-[min(78vw,360px)] shrink-0 animate-[enter-soft_1000ms_var(--ease-out)_450ms_backwards] lg:w-[min(27vw,400px)]">
            <TicketVivo local={demo?.nombreComercial ?? "Policlínico San Román"} />
          </div>

          {/* Flancos (solo escritorio): la promesa a la izquierda, el dato duro a la derecha */}
          <div className="absolute inset-x-0 bottom-8 mx-auto hidden max-w-7xl items-end justify-between px-6 lg:flex">
            <div className="w-[300px] animate-[enter_600ms_var(--ease-out)_700ms_backwards]">
              <p className="text-[17px] leading-relaxed text-muted-foreground">El cliente escanea un QR, sigue su turno en el celular y recibe un WhatsApp cuando faltan dos personas.</p>
              {demo && (
                <Button asChild className="mt-4">
                  <Link href={`/l/${demo.slug}`}><QrCode className="size-4" /> Tomar un turno de prueba</Link>
                </Button>
              )}
            </div>
            <div className="w-[300px] animate-[enter_600ms_var(--ease-out)_780ms_backwards] text-right">
              <p className="text-[17px] font-medium">{gratis ? `Gratis hasta ${gratis.maxTurnosMes.toLocaleString("es-PE")} turnos al mes` : "Empieza gratis"}</p>
              <p className="text-[15px] text-muted-foreground">Sin instalar apps · Ley N.° 29733</p>
            </div>
          </div>
        </section>

        {/* Flancos en el celular: bajan después del hero */}
        <div className="space-y-4 px-6 py-10 lg:hidden">
          <p className="text-[17px] leading-relaxed text-muted-foreground">El cliente escanea un QR, sigue su turno en el celular y recibe un WhatsApp cuando faltan dos personas.</p>
          {demo && (
            <Button asChild size="lg" className="w-full">
              <Link href={`/l/${demo.slug}`}><QrCode className="size-5" /> Tomar un turno de prueba</Link>
            </Button>
          )}
          <p className="text-[15px] text-muted-foreground">{gratis ? `Gratis hasta ${gratis.maxTurnosMes.toLocaleString("es-PE")} turnos al mes` : "Empieza gratis"} · sin instalar apps</p>
        </div>

        {/* ------------------------------------------------ El problema, dicho de una vez */}
        <section className="bg-teal-950 text-teal-50">
          <Revelar className="mx-auto max-w-7xl px-6 py-24 lg:py-36">
            <p className="max-w-5xl text-[clamp(1.5rem,2.7vw,2.25rem)] font-semibold leading-[1.25] tracking-tight">
              En una sala de espera nadie sabe cuánto falta, se hace fila dos veces <span className="text-teal-300">(para anotarse y para ser atendido)</span> y nadie mide cuánta gente se va sin que la atiendan. TurnoYa resuelve las tres cosas con un QR.
            </p>
          </Revelar>
        </section>

        {/* ------------------------------------------------ Cómo funciona: acordeón de cuatro pasos */}
        <section id="como-funciona" className="mx-auto max-w-7xl scroll-mt-20 px-6 py-24 lg:py-32">
          <Revelar className="grid gap-6 lg:grid-cols-12">
            <h2 className="text-[clamp(2.25rem,4vw,3.75rem)] font-semibold leading-[1.02] tracking-[-0.03em] lg:col-span-5">Así funciona</h2>
            <p className="max-w-xl text-lg leading-relaxed text-muted-foreground lg:col-span-5 lg:col-start-7">
              Del QR al llamado en la TV, todo en tiempo real. Son cuatro pasos y ninguno le pide al cliente instalar una app ni crear una cuenta.
            </p>
          </Revelar>
          <Revelar retraso={120} className="mt-16">
            <PasosAcordeon />
          </Revelar>
        </section>

        {/* ------------------------------------------------ Qué incluye: un párrafo con controles reales */}
        <section className="mx-auto max-w-7xl px-6 pb-24 lg:pb-32">
          <h2 className="sr-only">Qué incluye</h2>
          <Revelar>
            <p className="max-w-6xl text-[clamp(1.6rem,3.2vw,2.75rem)] font-medium leading-[1.22] tracking-[-0.02em]">
              Cada turno se numera en la base de datos, sin duplicados
              <Ranura className="bg-slate-900 text-white"><span className="font-mono text-[0.36em] font-bold">A-001</span></Ranura>. El aviso sale por WhatsApp con su estado de entrega
              <Ranura className="bg-[#d9fdd3] text-sky-600"><CheckCheck className="size-[0.6em]" strokeWidth={2.5} /></Ranura>, la TV llama en menos de un segundo
              <Ranura className="gap-[0.08em] bg-slate-950 text-white"><Tv className="size-[0.5em]" /><span className="font-mono text-[0.3em] font-bold">A-018</span></Ranura> y el panel te dice cuánto espera tu gente
              <Ranura className="items-end gap-[0.06em] bg-teal-50 px-[0.18em] pb-[0.16em]">
                {[40, 65, 50, 85, 60].map((h, i) => (
                  <span key={i} className="w-[0.16em] rounded-t-[0.04em] bg-teal-600" style={{ height: `${h}%` }} />
                ))}
              </Ranura>. Con roles, teléfonos cifrados y borrado a los 90 días, como pide la Ley 29733.
            </p>
          </Revelar>
          <Revelar retraso={100} className="mt-16 grid lg:grid-cols-12">
            <div className="lg:col-span-5 lg:col-start-7">
              <p className="text-lg leading-relaxed text-muted-foreground">Un solo sistema web para clientes, ventanillas y administradores, con reportes exportables a CSV y PDF.</p>
              <Button asChild variant="outline" className="mt-5">
                <a href="#precios">Ver planes <ArrowRight className="size-4" /></a>
              </Button>
            </div>
          </Revelar>
        </section>

        {/* ------------------------------------------------ Lo que produce: índice con la pieza real */}
        <section className="mx-auto max-w-7xl px-6 pb-24 lg:pb-32">
          <Revelar>
            <IndiceSalidas local={demo?.nombreComercial ?? "Policlínico San Román"} url={`${appUrl()}/t/demo`} />
          </Revelar>
        </section>

        {/* ------------------------------------------------ Demo: tablero de salidas de terminal */}
        <section id="demo" className="scroll-mt-20 bg-slate-950 text-white">
          <div className="mx-auto max-w-7xl px-6 py-24 lg:py-32">
            <Revelar className="grid gap-6 lg:grid-cols-12">
              <h2 className="text-[clamp(2.25rem,4vw,3.75rem)] font-semibold leading-[1.02] tracking-[-0.03em] lg:col-span-5">Pruébalo ahora</h2>
              <p className="max-w-xl text-lg leading-relaxed text-white/65 lg:col-span-5 lg:col-start-7">
                Abre la pantalla TV en una pestaña, toma un turno desde el celular y llámalo desde el panel. Son datos de prueba, todo se actualiza en vivo.
              </p>
            </Revelar>

            <Revelar retraso={100} className="mt-14 overflow-hidden rounded-3xl bg-white/[0.04] ring-1 ring-white/10">
              <div className="hidden grid-cols-[2fr_1fr_2fr_auto] gap-6 px-6 py-3 text-[13px] font-semibold uppercase tracking-[0.18em] text-amber-300/80 md:grid">
                <span>Local</span>
                <span>Rubro</span>
                <span>Dirección</span>
                <span className="w-[260px]">Acceso</span>
              </div>
              <ul>
                {locales.map((l, i) => (
                  <li key={l.slug} style={{ ["--i" as string]: i }} className="grid gap-3 border-t border-white/10 px-6 py-5 transition-colors duration-200 hover:bg-white/[0.04] md:grid-cols-[2fr_1fr_2fr_auto] md:items-center md:gap-6">
                    <span className="flex items-center gap-3 text-xl font-semibold">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: l.colorPrimario, boxShadow: `0 0 12px ${l.colorPrimario}` }} />
                      {l.nombreComercial}
                    </span>
                    <span className="text-[15px] text-white/60">{l.rubro}</span>
                    <span className="text-[15px] text-white/60">{l.direccion}</span>
                    <span className="flex w-full gap-2 md:w-[260px]">
                      <Button asChild size="sm" className="flex-1 bg-white text-slate-950 hover:bg-white/90">
                        <Link href={`/l/${l.slug}`}><QrCode className="size-4" /> Tomar turno</Link>
                      </Button>
                      <Button asChild size="sm" variant="outline" className="flex-1 border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white">
                        <Link href={`/l/${l.slug}/tv`} target="_blank"><Tv className="size-4" /> TV</Link>
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="flex items-center gap-2 border-t border-white/10 px-6 py-3 text-[13px] text-white/50">
                <span className="relative flex size-2">
                  <span className="absolute inset-0 animate-live rounded-full bg-emerald-400" />
                  <span className="relative size-2 rounded-full bg-emerald-400" />
                </span>
                {totalTurnos.toLocaleString("es-PE")} turnos registrados en la demo
              </p>
            </Revelar>

            <Revelar retraso={160} className="mt-10">
              <h3 className="text-lg font-semibold">Cuentas de demostración</h3>
              <p className="mt-1 text-[15px] text-white/60">Entra al panel o a la administración con un clic.</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {CUENTAS_DEMO.map(([rol, email, pass, destino]) => (
                  <Link
                    key={email}
                    href={`/login?next=${destino}&email=${email}`}
                    className="press group flex flex-col justify-between rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10 hover:bg-white/[0.1] hover:ring-teal-400/50"
                  >
                    <span className="flex items-center justify-between font-medium">
                      {rol}
                      <ArrowUpRight className="size-4 text-white/40 transition-[translate,color] duration-200 ease-out group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-teal-300" />
                    </span>
                    <span className="mt-3 truncate font-mono text-[13px] text-white/50">{email}</span>
                    <span className="font-mono text-[13px] text-white/50">{pass}</span>
                  </Link>
                ))}
              </div>
            </Revelar>
          </div>
        </section>

        {/* ------------------------------------------------ Precios: cada plan impreso como boleto */}
        <section id="precios" className="scroll-mt-16 bg-secondary">
          <div className="mx-auto max-w-6xl px-6 py-24 lg:py-32">
            <Revelar className="grid gap-6 lg:grid-cols-12">
              <h2 className="text-[clamp(2.25rem,4vw,3.75rem)] font-semibold leading-[1.02] tracking-[-0.03em] lg:col-span-6">Un boleto por local</h2>
              <p className="max-w-xl text-lg leading-relaxed text-muted-foreground lg:col-span-5 lg:col-start-8">Suscripción mensual en soles, con IGV. Empieza gratis y cambia de plan cuando lo necesites.</p>
            </Revelar>
            <div className="mt-14 space-y-6">
              {planes.map((p, i) => {
                const destacado = p.codigo === "EMPRENDE";
                const precio = Number(p.precioMensual);
                const incluye = [
                  p.maxColas >= 99 ? "Colas ilimitadas" : `${p.maxColas} cola${p.maxColas > 1 ? "s" : ""}`,
                  `${p.maxVentanillas} ventanilla${p.maxVentanillas > 1 ? "s" : ""}`,
                  p.maxTurnosMes >= 100000 ? "Turnos ilimitados" : `Hasta ${p.maxTurnosMes.toLocaleString("es-PE")} turnos/mes`,
                  p.whatsappHabilitado ? `${p.maxAvisosWhatsapp.toLocaleString("es-PE")} avisos WhatsApp` : "Aviso por web",
                  "Pantalla TV en tiempo real",
                  ...(p.reportes ? ["Reportes y soporte prioritario"] : []),
                ];
                return (
                  <Revelar key={p.id} retraso={i * 90}>
                    <article className={cn("relative grid overflow-hidden rounded-2xl lg:grid-cols-[7fr_3fr]", destacado ? "bg-teal-700 text-white" : "bg-card text-foreground")}>
                      <div className="p-7 lg:p-10">
                        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                          <h3 className="text-[clamp(2rem,3.6vw,3rem)] font-semibold leading-none tracking-[-0.03em]">{p.nombre}</h3>
                          {destacado && <span className="text-[15px] font-medium text-teal-200">El que más eligen</span>}
                        </div>
                        <ul className={cn("mt-8 grid gap-x-8 gap-y-2 text-[16px] sm:grid-cols-2", destacado ? "text-teal-50" : "text-muted-foreground")}>
                          {incluye.map((x) => (
                            <li key={x} className="flex gap-2">
                              <span className={cn("mt-2.5 size-1.5 shrink-0 rounded-full", destacado ? "bg-teal-200" : "bg-teal-600")} /> {x}
                            </li>
                          ))}
                        </ul>
                      </div>
                      {/* Troquel: muescas arriba y abajo + perforación punteada */}
                      <div className={cn("relative flex flex-col items-center justify-center gap-5 p-7 lg:p-8", destacado ? "bg-teal-800" : "bg-muted/60")}>
                        <span aria-hidden className="absolute -left-3.5 -top-3.5 size-7 rounded-full bg-secondary" />
                        <span aria-hidden className="absolute size-7 rounded-full bg-secondary max-lg:-right-3.5 max-lg:-top-3.5 lg:-bottom-3.5 lg:-left-3.5" />
                        <span aria-hidden className="absolute inset-y-4 left-[-3px] hidden w-1.5 bg-[radial-gradient(circle,var(--secondary)_2.5px,transparent_3px)] bg-[length:6px_14px] lg:block" />
                        <span aria-hidden className="absolute inset-x-4 top-[-3px] h-1.5 bg-[radial-gradient(circle,var(--secondary)_2.5px,transparent_3px)] bg-[length:14px_6px] lg:hidden" />
                        <p className="text-center">
                          <span className="block text-[clamp(2.75rem,5vw,4.25rem)] font-semibold leading-none tracking-[-0.04em] tabular-nums">{soles(precio)}</span>
                          <span className={cn("text-[15px]", destacado ? "text-teal-200" : "text-muted-foreground")}>al mes</span>
                        </p>
                        <Button asChild size="lg" className={cn("h-14 w-full", destacado ? "bg-white text-teal-900 hover:bg-white/90" : "")}>
                          <Link href={`/registro?plan=${p.codigo}`}>Comenzar</Link>
                        </Button>
                      </div>
                    </article>
                  </Revelar>
                );
              })}
            </div>
            <p className="mt-8 text-[15px] text-muted-foreground">Instalación opcional: S/ 150 pago único (QR impreso, configuración y capacitación).</p>
          </div>
        </section>
      </main>

      {/* ------------------------------------------------ Cierre: invitación sobre el nombre recortado */}
      <footer className="relative overflow-hidden bg-teal-950 text-teal-50">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 pb-[18vw] pt-24 lg:grid-cols-12 lg:pt-32">
          <Revelar className="lg:col-span-7">
            <p className="text-[clamp(2.5rem,5vw,4.5rem)] font-semibold leading-[1] tracking-[-0.035em]">Tu sala de espera,<br />sin fila.</p>
            <Button asChild size="lg" className="mt-8 bg-white text-teal-950 hover:bg-white/90">
              <Link href="/registro">Crear mi local <ArrowRight className="size-4" /></Link>
            </Button>
          </Revelar>
          <nav aria-label="Enlaces" className="flex flex-col gap-2 text-[16px] lg:col-span-3 lg:col-start-10">
            <Link href="/login" className="w-fit text-teal-100/80 transition-colors hover:text-white">Ingresar</Link>
            {demo && <Link href={`/l/${demo.slug}`} className="w-fit text-teal-100/80 transition-colors hover:text-white">Tomar un turno</Link>}
            {demo && <Link href={`/l/${demo.slug}/tv`} target="_blank" className="w-fit text-teal-100/80 transition-colors hover:text-white">Pantalla TV</Link>}
            <a href="#precios" className="w-fit text-teal-100/80 transition-colors hover:text-white">Precios</a>
          </nav>
          <div className="flex flex-col justify-between gap-2 text-[13px] text-teal-100/55 lg:col-span-12 lg:flex-row">
            <p>Proyecto de perfil de egreso · EP Ingeniería de Sistemas, Universidad Peruana Unión, sede Juliaca · Emprendedorismo 2026-2</p>
            <p>Nick Mayta · Jhan Ramos · David Romero · Henyelrey Garcia · Datos personales eliminados a los 90 días (Ley N.° 29733)</p>
          </div>
        </div>
        <p aria-hidden className="pointer-events-none absolute -bottom-[0.06em] left-1/2 -translate-x-1/2 translate-y-[30%] select-none whitespace-nowrap text-[28vw] font-bold leading-none tracking-[-0.06em] text-teal-900">
          TurnoYa
        </p>
      </footer>
    </div>
  );
}
