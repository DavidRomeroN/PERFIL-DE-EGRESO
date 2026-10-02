"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Eye, EyeOff, Loader2, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/fetcher";
import type { Session } from "@/lib/auth";

const DEMO = [
  { rol: "Super admin", email: "superadmin@turnoya.pe", pass: "admin123" },
  { rol: "Admin local", email: "admin@policlinico.pe", pass: "admin123" },
  { rol: "Operador", email: "operador@policlinico.pe", pass: "operador123" },
];

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [ver, setVer] = useState(false);
  const [cargando, setCargando] = useState(false);

  async function entrar(e?: React.FormEvent, cred?: { email: string; pass: string }) {
    e?.preventDefault();
    const em = cred?.email ?? email;
    const pw = cred?.pass ?? password;
    setCargando(true);
    try {
      const s = await api<Session>("/api/v1/auth/login", { method: "POST", json: { email: em, password: pw } });
      toast.success(`Bienvenido, ${s.nombre}`);
      const next = params.get("next");
      router.push(next && next.startsWith("/") ? next : s.rol === "OPERADOR" ? "/panel" : "/admin");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo iniciar sesión");
      setCargando(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Panel lateral */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-slate-950 p-10 text-white lg:flex">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(20,184,166,0.35),transparent_60%)]" />
        <div className="relative">
          <Logo light />
        </div>
        <div className="relative max-w-md">
          <blockquote className="text-2xl font-medium leading-snug">“Antes la gente preguntaba cada cinco minutos cuánto faltaba. Ahora espera afuera y vuelve justo cuando la llamamos.”</blockquote>
          <p className="mt-4 text-sm text-white/60">Recepción · Policlínico piloto, Juliaca</p>
        </div>
        <div className="relative grid grid-cols-3 gap-4 text-sm">
          {[
            ["−40 %", "tiempo en sala"],
            ["< 5 %", "abandono"],
            ["< 1 s", "llamado en TV"],
          ].map(([v, l]) => (
            <div key={l} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-2xl font-bold">{v}</p>
              <p className="text-white/60">{l}</p>
            </div>
          ))}
        </div>
      </aside>

      {/* Formulario */}
      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="lg:hidden"><Logo /></div>
          <h1 className="mt-8 text-3xl font-bold tracking-tight">Ingresar</h1>
          <p className="mt-1 text-sm text-muted-foreground">Panel de ventanilla y administración del local.</p>

          <form onSubmit={entrar} className="mt-8 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Correo</Label>
              <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@local.pe" required className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Contraseña</Label>
              <div className="relative">
                <Input id="password" type={ver ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required className="h-11 pr-11" />
                <button type="button" onClick={() => setVer((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Mostrar contraseña">
                  {ver ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" className="h-11 w-full" disabled={cargando}>
              {cargando ? <Loader2 className="size-4 animate-spin" /> : <LockKeyhole className="size-4" />} Entrar
            </Button>
          </form>

          <div className="mt-8 rounded-2xl border bg-muted/40 p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Acceso rápido (demo)</p>
            <div className="mt-2 space-y-1.5">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  disabled={cargando}
                  onClick={() => {
                    setEmail(d.email);
                    setPassword(d.pass);
                    void entrar(undefined, { email: d.email, pass: d.pass });
                  }}
                  className="flex w-full items-center justify-between rounded-xl border bg-card px-3 py-2 text-left text-sm transition hover:border-teal-500 hover:shadow-sm disabled:opacity-60"
                >
                  <span>
                    <span className="block font-medium">{d.rol}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{d.email}</span>
                  </span>
                  <ArrowRight className="size-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            ¿Eres cliente? No necesitas cuenta: <Link href="/" className="font-medium text-teal-700 underline-offset-2 hover:underline">escanea el QR del local</Link>.
          </p>
        </div>
      </main>
    </div>
  );
}
