"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Check, Clock } from "lucide-react";
import { CheckAnimado } from "@/components/app/motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/brand/logo";
import { TarjetaMercadoPago, type DatosTarjetaBrick } from "@/components/app/tarjeta-mercadopago";
import { api, ApiError } from "@/lib/fetcher";

interface Plan { codigo: string; nombre: string; precio: number; descripcion: string | null }
interface Resultado { estado: string; pagoId?: number; slug: string | null; mensaje: string }

const slugDe = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/** Alta de un local: datos del negocio y del administrador; en planes de pago, el primer mes con tarjeta (Mercado Pago). */
export function Registro({ planes, inicial }: { planes: Plan[]; inicial: string }) {
  const [plan, setPlan] = useState(inicial);
  const [paso, setPaso] = useState<"datos" | "pago" | "listo">("datos");
  const [d, setD] = useState({ nombreComercial: "", razonSocial: "", ruc: "", rubro: "Salud", ciudad: "Juliaca", direccion: "", telefono: "", slug: "", adminNombre: "", adminEmail: "", password: "", aceptaTerminos: false });
  const [slugEditado, setSlugEditado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [res, setRes] = useState<Resultado | null>(null);
  const [clave, setClave] = useState(() => crypto.randomUUID());
  const elegido = useMemo(() => planes.find((p) => p.codigo === plan)!, [planes, plan]);
  const gratis = elegido.precio === 0;

  useEffect(() => {
    if (!slugEditado) setD((x) => ({ ...x, slug: slugDe(x.nombreComercial) }));
  }, [d.nombreComercial, slugEditado]);

  // Pago en revisión: se consulta hasta que Mercado Pago confirme
  useEffect(() => {
    if (!res?.pagoId || !["EN_PROCESO", "PENDIENTE"].includes(res.estado)) return;
    const t = setInterval(async () => {
      const r = await api<Resultado>(`/api/v1/public/pagos/${res.pagoId}?clave=${clave}`).catch(() => null);
      if (r && r.estado !== res.estado) setRes(r);
    }, 5000);
    return () => clearInterval(t);
  }, [res, clave]);

  const valido = d.nombreComercial.trim().length >= 2 && d.razonSocial.trim().length >= 2 && /^[a-z0-9-]{3,40}$/.test(d.slug) && d.adminNombre.trim().length >= 2 && /\S+@\S+\.\S+/.test(d.adminEmail) && d.password.length >= 8 && d.aceptaTerminos && (!d.ruc || /^\d{11}$/.test(d.ruc));

  async function enviar(tarjeta: DatosTarjetaBrick | null) {
    setError(null);
    setEnviando(true);
    try {
      const r = await api<Resultado>("/api/v1/public/registro", { method: "POST", json: { ...d, plan, claveIdem: clave, tarjeta, ruc: d.ruc || null } });
      setRes(r);
      if (r.estado === "RECHAZADO") throw new Error(r.mensaje);
      setPaso("listo");
    } catch (e) {
      const msg = e instanceof ApiError || e instanceof Error ? e.message : "No se pudo completar el registro";
      setError(msg);
      setClave(crypto.randomUUID()); // un reintento es un cobro nuevo, no el mismo intento rechazado
      if (e instanceof ApiError && ["SLUG_OCUPADO", "EMAIL_OCUPADO", "VALIDACION"].includes(e.codigo)) setPaso("datos");
      throw e; // el Brick muestra el error y permite reintentar
    } finally {
      setEnviando(false);
    }
  }

  const campo = (k: keyof typeof d, etiqueta: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={k}>{etiqueta}</Label>
      <Input id={k} value={String(d[k])} onChange={(e) => { if (k === "slug") setSlugEditado(true); setD({ ...d, [k]: k === "slug" ? slugDe(e.target.value) : e.target.value }); }} {...extra} />
    </div>
  );

  if (paso === "listo" && res) {
    const aprobado = res.estado === "APROBADO";
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        {aprobado ? <CheckAnimado /> : <span className="flex size-14 animate-pop items-center justify-center rounded-full bg-amber-100 text-amber-600 ring-8 ring-amber-50"><Clock className="size-7" /></span>}
        <h1 className="animate-enter text-2xl font-semibold tracking-tight [animation-delay:150ms]">{aprobado ? "¡Tu local está listo!" : "Pago en revisión"}</h1>
        <p className="animate-enter text-muted-foreground [animation-delay:200ms]">{res.mensaje}</p>
        {aprobado && (
          <div className="flex w-full animate-enter flex-col gap-4 [animation-delay:260ms]">
            <Button asChild className="h-12 w-full"><Link href={`/login?email=${encodeURIComponent(d.adminEmail)}&next=/admin`}>Ingresar al panel</Link></Button>
            {res.slug && <p className="text-sm">Tus clientes tomarán turno en <Link className="font-mono text-teal-700 underline" href={`/l/${res.slug}`}>/l/{res.slug}</Link></p>}
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl space-y-6 p-5 md:p-10">
      <div className="flex animate-enter items-center justify-between"><Logo href="/" /><Link href="/login" className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline">Ya tengo cuenta</Link></div>
      <div className="animate-enter [animation-delay:60ms]">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Crea tu local en TurnoYa</h1>
        <p className="mt-1.5 text-muted-foreground">Elige un plan, completa los datos y en un minuto tienes tu QR listo.</p>
      </div>

      <section aria-label="Plan" className="grid animate-enter gap-3 sm:grid-cols-3 [animation-delay:120ms]">
        {planes.map((p) => {
          const activo = plan === p.codigo;
          return (
            <button key={p.codigo} type="button" aria-pressed={activo} onClick={() => { setPlan(p.codigo); setPaso("datos"); }} className={cn("press relative rounded-2xl border bg-card p-4 text-left shadow-soft hover:border-teal-500/50", activo && "border-transparent")}>
              {activo && <motion.span layoutId="plan-elegido" className="absolute inset-0 rounded-2xl bg-teal-50 ring-2 ring-teal-600" transition={{ type: "spring", duration: 0.4, bounce: 0.12 }} aria-hidden />}
              <span className="relative flex items-start justify-between">
                <span>
                  <span className="block text-sm text-muted-foreground">{p.nombre}</span>
                  <span className="block text-2xl font-semibold tracking-tight">{p.precio === 0 ? "Gratis" : `S/ ${p.precio}`}<span className="text-sm font-normal text-muted-foreground">{p.precio ? " /mes" : ""}</span></span>
                </span>
                {activo && <span className="flex size-5 animate-pop items-center justify-center rounded-full bg-teal-600 text-white"><Check className="size-3.5" /></span>}
              </span>
            </button>
          );
        })}
      </section>

      {error && paso === "datos" && <p role="alert" className="animate-shake rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}

      {paso === "datos" && (
        <form className="animate-enter space-y-6 [animation-delay:180ms]" onSubmit={(e) => { e.preventDefault(); if (gratis) void enviar(null).catch(() => {}); else setPaso("pago"); }}>
          <fieldset className="grid gap-4 rounded-2xl border bg-card p-5 shadow-soft sm:grid-cols-2">
            <legend className="px-1 font-semibold">Tu negocio</legend>
            {campo("nombreComercial", "Nombre comercial", { required: true, maxLength: 80 })}
            {campo("razonSocial", "Razón social", { required: true, maxLength: 120 })}
            {campo("ruc", "RUC (opcional)", { inputMode: "numeric", maxLength: 11 })}
            {campo("rubro", "Rubro", { maxLength: 40 })}
            {campo("ciudad", "Ciudad", { maxLength: 60 })}
            {campo("telefono", "Teléfono (opcional)", { maxLength: 20 })}
            <div className="sm:col-span-2">{campo("slug", "Dirección para tus clientes (turnoya.pe/l/…)", { required: true, maxLength: 40 })}</div>
          </fieldset>
          <fieldset className="grid gap-4 rounded-2xl border bg-card p-5 shadow-soft sm:grid-cols-2">
            <legend className="px-1 font-semibold">Administrador</legend>
            {campo("adminNombre", "Tu nombre", { required: true, maxLength: 80 })}
            {campo("adminEmail", "Correo", { required: true, type: "email" })}
            {campo("password", "Contraseña (mínimo 8)", { required: true, type: "password", minLength: 8, autoComplete: "new-password" })}
          </fieldset>
          <label className={cn("flex cursor-pointer gap-3 rounded-2xl border p-3 text-sm transition-colors duration-200", d.aceptaTerminos ? "border-teal-600 bg-teal-50/60" : "hover:bg-muted/50")}>
            <input type="checkbox" className="mt-0.5 size-4 accent-teal-600" checked={d.aceptaTerminos} onChange={(e) => setD({ ...d, aceptaTerminos: e.target.checked })} />
            Acepto los términos del servicio y el tratamiento de datos (Ley 29733).{!gratis && ` Se cobrará S/ ${elegido.precio} por el primer mes.`}
          </label>
          <Button type="submit" className="h-12 w-full text-base" disabled={!valido || enviando}>{gratis ? (enviando ? "Creando…" : "Crear mi local gratis") : "Continuar al pago"}</Button>
        </form>
      )}

      {paso === "pago" && !gratis && (
        <section className="animate-enter space-y-4 rounded-2xl border bg-card p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">Plan {elegido.nombre} · 1 mes</p>
              <p className="text-sm text-muted-foreground">{d.nombreComercial} · {d.adminEmail}</p>
            </div>
            <p className="text-2xl font-bold">S/ {elegido.precio}</p>
          </div>
          {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
          <TarjetaMercadoPago monto={elegido.precio} email={d.adminEmail} onPagar={enviar} />
          <button type="button" className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline" onClick={() => setPaso("datos")}>← Volver a mis datos</button>
        </section>
      )}
    </main>
  );
}
