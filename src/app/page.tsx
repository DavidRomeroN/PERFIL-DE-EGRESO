import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Bell,
  CheckCircle2,
  Clock,
  LayoutDashboard,
  MessageCircle,
  MonitorPlay,
  QrCode,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Tv,
  Users,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { soles } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [planes, locales, statsRaw] = await Promise.all([
    prisma.plan.findMany({ orderBy: { precioMensual: "asc" } }).catch(() => []),
    prisma.local.findMany({ where: { activo: true }, orderBy: { id: "asc" }, select: { slug: true, nombreComercial: true, rubro: true, direccion: true, colorPrimario: true } }).catch(() => []),
    prisma.turno.aggregate({ _count: { _all: true } }).catch(() => ({ _count: { _all: 0 } })),
  ]);
  const demo = locales[0];
  const totalTurnos = statsRaw._count._all;

  return (
    <div className="flex min-h-screen flex-col">
      {/* ------------------------------------------------ Header */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Logo />
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#como-funciona" className="hover:text-foreground">Cómo funciona</a>
            <a href="#funciones" className="hover:text-foreground">Funciones</a>
            <a href="#demo" className="hover:text-foreground">Demo</a>
            <a href="#precios" className="hover:text-foreground">Precios</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
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

      <main className="flex-1">
        {/* ------------------------------------------------ Hero */}
        <section className="relative overflow-hidden bg-grid">
          <div className="absolute inset-0 -z-10 bg-gradient-to-b from-teal-50/80 via-background to-background" />
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 md:grid-cols-2 md:py-28">
            <div>
              <Badge variant="secondary" className="mb-5 gap-1.5 rounded-full px-3 py-1 text-teal-800">
                <Sparkles className="size-3.5" /> SaaS para salas de espera · Juliaca, Perú
              </Badge>
              <h1 className="text-balance text-4xl font-bold leading-[1.1] tracking-tight md:text-6xl">
                Espera donde quieras: <span className="bg-gradient-to-r from-teal-600 to-emerald-500 bg-clip-text text-transparent">te avisamos por WhatsApp</span> cuando te toca
              </h1>
              <p className="mt-6 max-w-xl text-lg text-muted-foreground">
                TurnoYa reemplaza la cola física por una fila virtual. El cliente escanea un QR, recibe su turno y un aviso cuando faltan 2 personas; el local
                muestra el llamado en su TV y gestiona ventanillas desde un panel con métricas.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                {demo && (
                  <Button asChild size="lg" className="h-12 px-6 text-base">
                    <Link href={`/l/${demo.slug}`}>
                      <QrCode className="size-5" /> Tomar un turno de prueba
                    </Link>
                  </Button>
                )}
                {demo && (
                  <Button asChild size="lg" variant="outline" className="h-12 px-6 text-base">
                    <Link href={`/l/${demo.slug}/tv`} target="_blank">
                      <Tv className="size-5" /> Ver pantalla TV
                    </Link>
                  </Button>
                )}
              </div>
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-4 text-teal-600" /> Sin instalar apps</span>
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-4 text-teal-600" /> Puesta en marcha en 1 día</span>
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-4 text-teal-600" /> Ley 29733 cumplida</span>
              </div>
            </div>

            {/* Mock visual */}
            <div className="relative mx-auto w-full max-w-md">
              <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-tr from-teal-200/60 via-emerald-100/40 to-amber-100/60 blur-2xl" />
              <div className="rounded-3xl border bg-card p-5 shadow-xl">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Tu turno</p>
                    <p className="text-sm font-medium">Policlínico San Román · Medicina General</p>
                  </div>
                  <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Avisado</Badge>
                </div>
                <div className="mt-6 text-center">
                  <p className="font-mono text-7xl font-bold tracking-tight text-teal-700">A-018</p>
                  <p className="mt-2 text-muted-foreground">Faltan <span className="font-semibold text-foreground">2 personas</span> · ~ 12 min</p>
                </div>
                <div className="mt-6 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full w-[78%] rounded-full bg-gradient-to-r from-teal-500 to-emerald-400" />
                </div>
                <div className="mt-6 rounded-2xl bg-[#e7f6ec] p-3 text-sm shadow-inner">
                  <div className="flex items-start gap-2">
                    <MessageCircle className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    <p className="text-emerald-950">
                      Hola María 👋, tu turno <b>A-018</b> en <b>Policlínico San Román</b> está por llegar: faltan 2 personas. Acércate a la sala.
                    </p>
                  </div>
                  <p className="mt-1 text-right text-[11px] text-emerald-700">WhatsApp · entregado ✓✓</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ Problema */}
        <section className="border-y bg-muted/40">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-14 md:grid-cols-3">
            {[
              { n: "“¿Cuánto falta?”", d: "El cliente no sabe su posición, pregunta varias veces y se va sin consumir." },
              { n: "Sala colapsada", d: "Cola doble: para anotarse y para ser atendido. Llamados a viva voz que no se oyen." },
              { n: "Sin datos", d: "Recepción no sabe cuánta gente llega por hora ni cuántos abandonan." },
            ].map((p) => (
              <div key={p.n} className="rounded-2xl border bg-card p-6">
                <p className="text-lg font-semibold">{p.n}</p>
                <p className="mt-2 text-sm text-muted-foreground">{p.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------ Cómo funciona */}
        <section id="como-funciona" className="mx-auto max-w-6xl px-4 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Así funciona</h2>
            <p className="mt-3 text-muted-foreground">Del QR al llamado en la TV, todo en tiempo real.</p>
          </div>
          <ol className="mt-12 grid gap-6 md:grid-cols-4">
            {[
              { icon: QrCode, t: "Escanea el QR", d: "El cliente abre la web del local, elige el servicio y toma su turno en 3 toques." },
              { icon: Smartphone, t: "Sigue su turno", d: "Ve su posición y tiempo estimado desde el celular. Puede salir del local." },
              { icon: Bell, t: "Recibe el aviso", d: "Cuando faltan 2 personas, le llega un WhatsApp automático." },
              { icon: Tv, t: "Lo llaman en la TV", d: "La ventanilla pulsa “Llamar siguiente”, la TV muestra el número y suena el timbre." },
            ].map((s, i) => (
              <li key={s.t} className="relative rounded-2xl border bg-card p-6">
                <span className="absolute -top-3 left-6 rounded-full bg-teal-600 px-2.5 py-0.5 text-xs font-semibold text-white">Paso {i + 1}</span>
                <s.icon className="size-8 text-teal-600" />
                <h3 className="mt-4 font-semibold">{s.t}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{s.d}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ------------------------------------------------ Funciones */}
        <section id="funciones" className="border-y bg-slate-950 text-slate-100">
          <div className="mx-auto max-w-6xl px-4 py-20">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Todo lo que necesita tu sala de espera</h2>
              <p className="mt-3 text-slate-400">Un solo sistema web para clientes, ventanillas y administradores.</p>
            </div>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { icon: QrCode, t: "Turno por QR o ticket", d: "Numeración diaria por cola (A-001, B-001…) emitida en la base de datos sin duplicados." },
                { icon: MessageCircle, t: "Aviso por WhatsApp", d: "Plantilla aprobada, envío asíncrono con reintentos y estado de entrega (enviado, entregado, leído)." },
                { icon: MonitorPlay, t: "Pantalla TV en tiempo real", d: "Llamado propagado en menos de 1 segundo con timbre y voz. Personalizable con logo y mensajes." },
                { icon: LayoutDashboard, t: "Panel de ventanilla", d: "Llamar siguiente, rellamar, atendido o no se presentó con un clic. Ticket impreso para quien no tiene celular." },
                { icon: BarChart3, t: "Reportes de demanda", d: "Espera promedio, abandono, turnos por hora y por cola. Exportable a CSV." },
                { icon: ShieldCheck, t: "Seguro y multi-local", d: "Roles, JWT, aislamiento por local, teléfonos cifrados y borrado a 90 días (Ley 29733)." },
              ].map((f) => (
                <div key={f.t} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 transition hover:border-teal-700/60 hover:bg-slate-900">
                  <f.icon className="size-7 text-teal-400" />
                  <h3 className="mt-4 font-semibold text-white">{f.t}</h3>
                  <p className="mt-1.5 text-sm text-slate-400">{f.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ Demo */}
        <section id="demo" className="mx-auto max-w-6xl px-4 py-20">
          <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
            <div>
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Pruébalo ahora</h2>
              <p className="mt-3 max-w-xl text-muted-foreground">
                Entorno de demostración con datos de prueba. Abre la pantalla TV en una pestaña, toma un turno desde el celular y llama desde el panel.
              </p>
            </div>
            <Badge variant="outline" className="rounded-full">
              {totalTurnos.toLocaleString("es-PE")} turnos registrados en la demo
            </Badge>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
            <div className="grid gap-4 sm:grid-cols-2">
              {locales.map((l) => (
                <Card key={l.slug} className="overflow-hidden">
                  <div className="h-1.5" style={{ background: l.colorPrimario }} />
                  <CardContent className="pt-5">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">{l.rubro}</p>
                    <h3 className="mt-1 text-lg font-semibold">{l.nombreComercial}</h3>
                    <p className="text-sm text-muted-foreground">{l.direccion}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button asChild size="sm">
                        <Link href={`/l/${l.slug}`}><QrCode className="size-4" /> Tomar turno</Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/l/${l.slug}/tv`} target="_blank"><Tv className="size-4" /> Pantalla TV</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card className="bg-muted/40">
              <CardContent className="pt-6">
                <h3 className="flex items-center gap-2 font-semibold"><Users className="size-5 text-teal-600" /> Cuentas de demostración</h3>
                <p className="mt-1 text-sm text-muted-foreground">Ingresa en <Link href="/login" className="font-medium text-teal-700 underline-offset-2 hover:underline">/login</Link> con cualquiera de estas cuentas.</p>
                <div className="mt-4 space-y-2 text-sm">
                  {[
                    ["Super admin TurnoYa", "superadmin@turnoya.pe", "admin123", "/admin/locales"],
                    ["Admin · Policlínico", "admin@policlinico.pe", "admin123", "/admin"],
                    ["Operador · Policlínico", "operador@policlinico.pe", "operador123", "/panel"],
                    ["Admin · Transportes", "admin@transportes.pe", "admin123", "/admin"],
                  ].map(([rol, email, pass, destino]) => (
                    <div key={email} className="flex items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{rol}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">{email} · {pass}</p>
                      </div>
                      <Button asChild size="sm" variant="ghost" className="shrink-0">
                        <Link href={`/login?next=${destino}&email=${email}`}>Entrar</Link>
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* ------------------------------------------------ Precios */}
        <section id="precios" className="border-t bg-muted/30">
          <div className="mx-auto max-w-6xl px-4 py-20">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Planes para cada mype</h2>
              <p className="mt-3 text-muted-foreground">Suscripción mensual por local. Empieza gratis y crece cuando lo necesites.</p>
            </div>
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {planes.map((p) => {
                const destacado = p.codigo === "EMPRENDE";
                return (
                  <Card key={p.id} className={cn("relative flex flex-col overflow-visible", destacado && "ring-2 ring-teal-600 shadow-lg shadow-teal-600/10")}>
                    {destacado && <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-teal-600">Más popular</Badge>}
                    <CardContent className="flex flex-1 flex-col pt-6">
                      <p className="text-sm font-medium text-muted-foreground">{p.nombre}</p>
                      <p className="mt-2 text-4xl font-bold tracking-tight">
                        {Number(p.precioMensual) === 0 ? "Gratis" : soles(Number(p.precioMensual))}
                        {Number(p.precioMensual) > 0 && <span className="text-base font-normal text-muted-foreground"> /mes</span>}
                      </p>
                      <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                        <li className="flex gap-2"><CheckCircle2 className="size-4 shrink-0 text-teal-600" /> {p.maxColas >= 99 ? "Colas ilimitadas" : `${p.maxColas} cola${p.maxColas > 1 ? "s" : ""}`}</li>
                        <li className="flex gap-2"><CheckCircle2 className="size-4 shrink-0 text-teal-600" /> {p.maxVentanillas} ventanilla{p.maxVentanillas > 1 ? "s" : ""}</li>
                        <li className="flex gap-2"><CheckCircle2 className="size-4 shrink-0 text-teal-600" /> {p.maxTurnosMes >= 100000 ? "Turnos ilimitados" : `Hasta ${p.maxTurnosMes.toLocaleString("es-PE")} turnos/mes`}</li>
                        <li className="flex gap-2"><CheckCircle2 className="size-4 shrink-0 text-teal-600" /> {p.whatsappHabilitado ? `${p.maxAvisosWhatsapp.toLocaleString("es-PE")} avisos WhatsApp` : "Aviso por web (sin WhatsApp)"}</li>
                        <li className="flex gap-2"><CheckCircle2 className="size-4 shrink-0 text-teal-600" /> Pantalla TV en tiempo real</li>
                        {p.reportes && <li className="flex gap-2"><CheckCircle2 className="size-4 shrink-0 text-teal-600" /> Reportes y soporte prioritario</li>}
                      </ul>
                      <Button asChild className="mt-6" variant={destacado ? "default" : "outline"}>
                        <Link href={`/registro?plan=${p.codigo}`}>Comenzar</Link>
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            <p className="mt-6 text-center text-sm text-muted-foreground">
              Instalación opcional: S/ 150 pago único (QR impreso, configuración, capacitación). Precios en soles, incluyen IGV.
            </p>
          </div>
        </section>
      </main>

      {/* ------------------------------------------------ Footer */}
      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 py-10 md:flex-row md:items-center">
          <div>
            <Logo />
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              Proyecto de perfil de egreso · EP Ingeniería de Sistemas, Universidad Peruana Unión — sede Juliaca. Emprendedorismo 2026-2.
            </p>
          </div>
          <div className="text-sm text-muted-foreground">
            <p>Equipo: Nick Mayta · Jhan Ramos · David Romero · Henyelrey Garcia</p>
            <p className="mt-1 inline-flex items-center gap-1.5"><Clock className="size-3.5" /> Datos personales eliminados a los 90 días · Ley N.° 29733</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
