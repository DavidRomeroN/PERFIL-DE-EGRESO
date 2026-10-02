"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CreditCard, Loader2, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/fetcher";
import { soles } from "@/lib/format";

interface Props {
  local: { nombreComercial: string; razonSocial: string; ruc: string; rubro: string; direccion: string; telefono: string; slug: string; zonaHoraria: string };
  plan: { nombre: string; codigo: string; precio: number; maxTurnosMes: number; maxColas: number; maxVentanillas: number; whatsapp: boolean; maxAvisos: number };
  uso: { turnosMes: number; avisosMes: number; colas: number; ventanillas: number; usuarios: number };
}

export function ConfiguracionAdmin({ local, plan, uso }: Props) {
  const router = useRouter();
  const [form, setForm] = useState(local);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    try {
      await api("/api/v1/local", { method: "PATCH", json: { nombreComercial: form.nombreComercial, razonSocial: form.razonSocial, ruc: form.ruc || null, rubro: form.rubro, direccion: form.direccion || null, telefono: form.telefono || null } });
      toast.success("Datos del local guardados");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setGuardando(false);
    }
  }

  const pct = (a: number, b: number) => (b >= 100000 ? 2 : Math.min(100, Math.round((a / b) * 100)));

  return (
    <div>
      <PageHeader title="Configuración del local" description="Datos del negocio, plan contratado y uso del mes." />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="rounded-2xl border bg-card p-6 shadow-sm">
          <h2 className="flex items-center gap-2 font-semibold"><Building2 className="size-4 text-teal-600" /> Datos del negocio</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="nc">Nombre comercial</Label>
              <Input id="nc" value={form.nombreComercial} onChange={(e) => setForm({ ...form, nombreComercial: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rs">Razón social</Label>
              <Input id="rs" value={form.razonSocial} onChange={(e) => setForm({ ...form, razonSocial: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ruc">RUC</Label>
              <Input id="ruc" value={form.ruc} onChange={(e) => setForm({ ...form, ruc: e.target.value.replace(/\D/g, "").slice(0, 11) })} className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rubro">Rubro</Label>
              <Input id="rubro" value={form.rubro} onChange={(e) => setForm({ ...form, rubro: e.target.value })} placeholder="Salud, Transporte, Belleza…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tel">Teléfono</Label>
              <Input id="tel" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="dir">Dirección</Label>
              <Input id="dir" value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Identificador público (URL)</Label>
              <Input value={`/l/${local.slug}`} readOnly className="bg-muted font-mono text-muted-foreground" />
            </div>
            <div className="space-y-1.5">
              <Label>Zona horaria</Label>
              <Input value={local.zonaHoraria} readOnly className="bg-muted text-muted-foreground" />
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <Button onClick={guardar} disabled={guardando}>{guardando ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Guardar</Button>
          </div>

          <div className="mt-8 rounded-2xl border border-teal-200 bg-teal-50/60 p-4 text-sm text-teal-950">
            <p className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-4" /> Protección de datos (Ley N.° 29733)</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-teal-900/80">
              <li>Solo se recolecta nombre (opcional) y celular (opcional) con consentimiento explícito.</li>
              <li>Los celulares se almacenan cifrados (AES-256-GCM) y con hash para evitar duplicados.</li>
              <li>Los datos personales se anonimizan automáticamente a los 90 días.</li>
              <li>Cada local solo accede a sus propios datos (aislamiento multi-tenant).</li>
            </ul>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold"><CreditCard className="size-4 text-teal-600" /> Plan actual</h2>
              <Badge>{plan.nombre}</Badge>
            </div>
            <p className="mt-3 text-3xl font-bold">{plan.precio === 0 ? "Gratis" : soles(plan.precio)}{plan.precio > 0 && <span className="text-sm font-normal text-muted-foreground"> /mes</span>}</p>

            <div className="mt-5 space-y-4 text-sm">
              <div>
                <div className="flex justify-between"><span>Turnos este mes</span><span className="tabular text-muted-foreground">{uso.turnosMes.toLocaleString("es-PE")} / {plan.maxTurnosMes >= 100000 ? "∞" : plan.maxTurnosMes.toLocaleString("es-PE")}</span></div>
                <Progress value={pct(uso.turnosMes, plan.maxTurnosMes)} className="mt-1.5" />
              </div>
              <div>
                <div className="flex justify-between"><span>Avisos WhatsApp</span><span className="tabular text-muted-foreground">{plan.whatsapp ? `${uso.avisosMes} / ${plan.maxAvisos.toLocaleString("es-PE")}` : "No incluido"}</span></div>
                <Progress value={plan.whatsapp ? pct(uso.avisosMes, plan.maxAvisos) : 0} className="mt-1.5" />
              </div>
              <div>
                <div className="flex justify-between"><span>Colas</span><span className="tabular text-muted-foreground">{uso.colas} / {plan.maxColas >= 99 ? "∞" : plan.maxColas}</span></div>
                <Progress value={plan.maxColas >= 99 ? 5 : pct(uso.colas, plan.maxColas)} className="mt-1.5" />
              </div>
              <div>
                <div className="flex justify-between"><span>Ventanillas</span><span className="tabular text-muted-foreground">{uso.ventanillas} / {plan.maxVentanillas}</span></div>
                <Progress value={pct(uso.ventanillas, plan.maxVentanillas)} className="mt-1.5" />
              </div>
              <p className="text-xs text-muted-foreground">{uso.usuarios} usuario{uso.usuarios === 1 ? "" : "s"} con acceso.</p>
            </div>
            {plan.codigo !== "PRO" && (
              <Button variant="outline" className="mt-5 w-full" onClick={() => toast.info("Contacta al equipo TurnoYa para cambiar de plan: ventas@turnoya.pe")}>
                Mejorar plan
              </Button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
