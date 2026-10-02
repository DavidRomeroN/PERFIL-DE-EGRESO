"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, ExternalLink, Loader2, LogIn, Pencil, Plus, Power, QrCode } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, StatCard, EmptyState } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/fetcher";
import { soles } from "@/lib/format";

interface Plan {
  id: number;
  codigo: string;
  nombre: string;
  precioMensual: string;
  maxTurnosMes: number;
  maxColas: number;
  maxVentanillas: number;
  whatsappHabilitado: boolean;
  maxAvisosWhatsapp: number;
}
interface Local {
  id: number;
  slug: string;
  nombreComercial: string;
  razonSocial: string;
  ruc: string | null;
  rubro: string;
  direccion: string | null;
  telefono: string | null;
  ciudad: string;
  planId: number;
  plan: Plan;
  colorPrimario: string;
  activo: boolean;
  turnosMes: number;
  _count: { colas: number; ventanillas: number; usuarios: number; turnos: number };
}

type Form = {
  id?: number;
  slug: string;
  nombreComercial: string;
  razonSocial: string;
  ruc: string;
  rubro: string;
  direccion: string;
  telefono: string;
  ciudad: string;
  planId: number;
  colorPrimario: string;
  adminNombre: string;
  adminEmail: string;
  adminPassword: string;
};

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export function LocalesAdmin() {
  const router = useRouter();
  const [locales, setLocales] = useState<Local[] | null>(null);
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [l, p] = await Promise.all([api<Local[]>("/api/v1/locales"), api<Plan[]>("/api/v1/planes")]);
      setLocales(l);
      setPlanes(p);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al cargar");
    }
  }, []);
  useEffect(() => void cargar(), [cargar]);

  function nuevo() {
    setForm({ slug: "", nombreComercial: "", razonSocial: "", ruc: "", rubro: "Salud", direccion: "", telefono: "", ciudad: "Juliaca", planId: planes.find((p) => p.codigo === "EMPRENDE")?.id ?? planes[0]?.id ?? 1, colorPrimario: "#0f766e", adminNombre: "", adminEmail: "", adminPassword: "" });
  }
  function editar(l: Local) {
    setForm({ id: l.id, slug: l.slug, nombreComercial: l.nombreComercial, razonSocial: l.razonSocial, ruc: l.ruc ?? "", rubro: l.rubro, direccion: l.direccion ?? "", telefono: l.telefono ?? "", ciudad: l.ciudad, planId: l.planId, colorPrimario: l.colorPrimario, adminNombre: "", adminEmail: "", adminPassword: "" });
  }

  async function guardar() {
    if (!form) return;
    setGuardando(true);
    try {
      const { id, adminNombre, adminEmail, adminPassword, ...data } = form;
      const payload = { ...data, ruc: data.ruc || null, direccion: data.direccion || null, telefono: data.telefono || null };
      if (id) await api(`/api/v1/locales/${id}`, { method: "PATCH", json: payload });
      else await api("/api/v1/locales", { method: "POST", json: { ...payload, ...(adminEmail ? { adminNombre: adminNombre || "Administrador", adminEmail, adminPassword } : {}) } });
      toast.success(id ? "Local actualizado" : "Local creado con su cola y ventanilla iniciales");
      setForm(null);
      await cargar();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setGuardando(false);
    }
  }

  async function alternar(l: Local) {
    try {
      await api(`/api/v1/locales/${l.id}`, { method: "PATCH", json: { activo: !l.activo } });
      toast.success(l.activo ? "Local desactivado" : "Local activado");
      await cargar();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  }

  async function administrar(l: Local) {
    await api("/api/v1/locales/activo", { method: "POST", json: { localId: l.id } });
    router.push("/admin");
    router.refresh();
  }

  const activos = locales?.filter((l) => l.activo) ?? [];
  const mrr = activos.reduce((a, l) => a + Number(l.plan.precioMensual), 0);
  const turnosMes = activos.reduce((a, l) => a + l.turnosMes, 0);

  return (
    <div>
      <PageHeader title="Locales y planes" description="Alta de locales (multi-tenant), plan contratado y uso. Cada local está aislado por local_id (RF11).">
        <Button onClick={nuevo}><Plus className="size-4" /> Nuevo local</Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Locales activos" value={activos.length} hint={`${(locales?.length ?? 0) - activos.length} inactivos`} icon={Building2} />
        <StatCard label="Ingreso mensual recurrente" value={soles(mrr)} hint="Suma de suscripciones activas" icon={Power} tone="good" />
        <StatCard label="Turnos este mes" value={turnosMes.toLocaleString("es-PE")} hint="Todos los locales" icon={QrCode} />
      </div>

      {/* Planes */}
      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {planes.map((p) => (
          <div key={p.id} className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="font-semibold">{p.nombre}</p>
              <Badge variant="outline">{Number(p.precioMensual) === 0 ? "Gratis" : `${soles(Number(p.precioMensual))}/mes`}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {p.maxColas >= 99 ? "Colas ilimitadas" : `${p.maxColas} cola(s)`} · {p.maxVentanillas} ventanilla(s) · {p.maxTurnosMes >= 100000 ? "turnos ilimitados" : `${p.maxTurnosMes} turnos/mes`} · {p.whatsappHabilitado ? `${p.maxAvisosWhatsapp} avisos WhatsApp` : "sin WhatsApp"}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">{locales?.filter((l) => l.planId === p.id && l.activo).length ?? 0} local(es) en este plan</p>
          </div>
        ))}
      </div>

      {locales === null ? (
        <div className="mt-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Cargando…</div>
      ) : locales.length === 0 ? (
        <div className="mt-6"><EmptyState icon={Building2} title="Sin locales" description="Da de alta el primer local." /></div>
      ) : (
        <div className="mt-6 rounded-2xl border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Local</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="hidden md:table-cell text-right">Turnos/mes</TableHead>
                <TableHead className="hidden lg:table-cell text-right">Colas · Vent. · Usuarios</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locales.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span className="size-9 shrink-0 rounded-lg" style={{ background: l.colorPrimario }} />
                      <div className="min-w-0">
                        <p className="font-medium">{l.nombreComercial}</p>
                        <p className="truncate text-xs text-muted-foreground">{l.rubro} · {l.direccion ?? l.ciudad} · <Link href={`/l/${l.slug}`} target="_blank" className="font-mono hover:underline">/l/{l.slug}</Link></p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><Badge variant={l.plan.codigo === "PRO" ? "default" : l.plan.codigo === "EMPRENDE" ? "success" : "secondary"}>{l.plan.nombre}</Badge></TableCell>
                  <TableCell className="hidden md:table-cell text-right tabular">{l.turnosMes.toLocaleString("es-PE")}<span className="text-xs text-muted-foreground"> / {l.plan.maxTurnosMes >= 100000 ? "∞" : l.plan.maxTurnosMes}</span></TableCell>
                  <TableCell className="hidden lg:table-cell text-right tabular text-muted-foreground">{l._count.colas} · {l._count.ventanillas} · {l._count.usuarios}</TableCell>
                  <TableCell><Badge variant={l.activo ? "success" : "secondary"}>{l.activo ? "Activo" : "Inactivo"}</Badge></TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon-sm" title="Administrar este local" onClick={() => administrar(l)}><LogIn className="size-4" /></Button>
                    <Button asChild variant="ghost" size="icon-sm" title="Pantalla TV"><Link href={`/l/${l.slug}/tv`} target="_blank"><ExternalLink className="size-4" /></Link></Button>
                    <Button variant="ghost" size="icon-sm" title="Editar" onClick={() => editar(l)}><Pencil className="size-4" /></Button>
                    <Button variant="ghost" size="icon-sm" title={l.activo ? "Desactivar" : "Activar"} className={l.activo ? "text-rose-600" : "text-emerald-600"} onClick={() => alternar(l)}><Power className="size-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar local" : "Nuevo local"}</DialogTitle>
            <DialogDescription>{form?.id ? "Actualiza datos y plan." : "Se crea con una cola “A · Atención general” y una ventanilla. Opcionalmente, crea el administrador inicial."}</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Nombre comercial</Label>
                  <Input value={form.nombreComercial} onChange={(e) => setForm({ ...form, nombreComercial: e.target.value, slug: form.id ? form.slug : slugify(e.target.value) })} placeholder="Clínica Santa Rosa" />
                </div>
                <div className="space-y-1.5">
                  <Label>Identificador (URL)</Label>
                  <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })} className="font-mono" placeholder="clinica-santa-rosa" />
                </div>
                <div className="space-y-1.5">
                  <Label>Plan</Label>
                  <NativeSelect value={form.planId} onChange={(e) => setForm({ ...form, planId: Number(e.target.value) })}>
                    {planes.map((p) => <option key={p.id} value={p.id}>{p.nombre} — {Number(p.precioMensual) === 0 ? "Gratis" : `${soles(Number(p.precioMensual))}/mes`}</option>)}
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label>Razón social</Label>
                  <Input value={form.razonSocial} onChange={(e) => setForm({ ...form, razonSocial: e.target.value })} placeholder="Clínica Santa Rosa S.A.C." />
                </div>
                <div className="space-y-1.5">
                  <Label>RUC</Label>
                  <Input value={form.ruc} onChange={(e) => setForm({ ...form, ruc: e.target.value.replace(/\D/g, "").slice(0, 11) })} className="font-mono" />
                </div>
                <div className="space-y-1.5">
                  <Label>Rubro</Label>
                  <Input value={form.rubro} onChange={(e) => setForm({ ...form, rubro: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Ciudad</Label>
                  <Input value={form.ciudad} onChange={(e) => setForm({ ...form, ciudad: e.target.value })} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Dirección</Label>
                  <Input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Teléfono</Label>
                  <Input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Color</Label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={form.colorPrimario} onChange={(e) => setForm({ ...form, colorPrimario: e.target.value })} className="size-10 cursor-pointer rounded-lg border bg-card p-1" />
                    <Input value={form.colorPrimario} onChange={(e) => setForm({ ...form, colorPrimario: e.target.value })} className="font-mono" maxLength={7} />
                  </div>
                </div>
              </div>

              {!form.id && (
                <div className="rounded-xl border bg-muted/40 p-3">
                  <p className="text-sm font-medium">Administrador inicial (opcional)</p>
                  <div className="mt-2 grid gap-3 sm:grid-cols-3">
                    <Input value={form.adminNombre} onChange={(e) => setForm({ ...form, adminNombre: e.target.value })} placeholder="Nombre" />
                    <Input type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} placeholder="correo@local.pe" />
                    <Input type="password" value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} placeholder="Contraseña" />
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancelar</Button>
            <Button onClick={guardar} disabled={guardando || !form || form.slug.length < 3 || form.nombreComercial.length < 2 || form.razonSocial.length < 2}>
              {guardando && <Loader2 className="size-4 animate-spin" />} Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
