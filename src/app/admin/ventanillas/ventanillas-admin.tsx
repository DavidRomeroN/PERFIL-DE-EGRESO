"use client";

import { useCallback, useEffect, useState } from "react";
import { Columns3, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, EmptyState } from "@/components/app/page-header";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/fetcher";

interface Ventanilla {
  id: number;
  nombre: string;
  activa: boolean;
  colaId: number | null;
  cola: { id: number; nombre: string; prefijo: string } | null;
}
interface Cola {
  id: number;
  nombre: string;
  prefijo: string;
  activa: boolean;
}

export function VentanillasAdmin() {
  const [items, setItems] = useState<Ventanilla[] | null>(null);
  const [colas, setColas] = useState<Cola[]>([]);
  const [form, setForm] = useState<{ id?: number; nombre: string; colaId: number | null; activa: boolean }>({ nombre: "", colaId: null, activa: true });
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [borrar, setBorrar] = useState<Ventanilla | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [v, c] = await Promise.all([api<Ventanilla[]>("/api/v1/ventanillas"), api<Cola[]>("/api/v1/colas")]);
      setItems(v);
      setColas(c);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al cargar");
    }
  }, []);
  useEffect(() => void cargar(), [cargar]);

  async function guardar() {
    setGuardando(true);
    try {
      const { id, ...data } = form;
      if (id) await api(`/api/v1/ventanillas/${id}`, { method: "PATCH", json: data });
      else await api("/api/v1/ventanillas", { method: "POST", json: data });
      toast.success(id ? "Ventanilla actualizada" : "Ventanilla creada");
      setAbierto(false);
      await cargar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar() {
    if (!borrar) return;
    setGuardando(true);
    try {
      const r = await api<{ desactivada?: boolean }>(`/api/v1/ventanillas/${borrar.id}`, { method: "DELETE" });
      toast.success(r.desactivada ? "Tiene historial: se desactivó" : "Ventanilla eliminada");
      setBorrar(null);
      await cargar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <PageHeader title="Ventanillas" description="Puntos de atención (consultorios, cajas, módulos). Cada ventanilla puede atender una cola específica o todas.">
        <Button onClick={() => { setForm({ nombre: "", colaId: colas[0]?.id ?? null, activa: true }); setAbierto(true); }}><Plus className="size-4" /> Nueva ventanilla</Button>
      </PageHeader>

      {items === null ? (
        <div className="space-y-2.5" aria-busy="true" aria-label="Cargando"><div className="skeleton h-12 rounded-2xl" /><div className="skeleton h-12 rounded-2xl opacity-80" /><div className="skeleton h-12 rounded-2xl opacity-60" /></div>
      ) : items.length === 0 ? (
        <EmptyState icon={Columns3} title="Sin ventanillas" description="Crea al menos una ventanilla para poder llamar turnos." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((v, i) => (
            <div key={v.id} style={{ ["--i" as string]: i }} className="flex animate-enter stagger flex-col rounded-2xl border bg-card p-5 shadow-soft">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-semibold">{v.nombre}</p>
                  <p className="text-sm text-muted-foreground">{v.cola ? `Atiende ${v.cola.prefijo} · ${v.cola.nombre}` : "Atiende todas las colas"}</p>
                </div>
                <Badge variant={v.activa ? "success" : "secondary"}>{v.activa ? "Activa" : "Inactiva"}</Badge>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <Switch checked={v.activa} onCheckedChange={async (val) => { await api(`/api/v1/ventanillas/${v.id}`, { method: "PATCH", json: { activa: val } }).catch((e) => toast.error(e.message)); await cargar(); }} />
                <div>
                  <Button variant="ghost" size="icon-sm" onClick={() => { setForm({ id: v.id, nombre: v.nombre, colaId: v.colaId, activa: v.activa }); setAbierto(true); }}><Pencil className="size-4" /></Button>
                  <Button variant="ghost" size="icon-sm" className="text-rose-600" onClick={() => setBorrar(v)}><Trash2 className="size-4" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar ventanilla" : "Nueva ventanilla"}</DialogTitle>
            <DialogDescription>El nombre aparece en la pantalla TV y en el aviso de WhatsApp.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="vnombre">Nombre</Label>
              <Input id="vnombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Consultorio 1" />
            </div>
            <div className="space-y-1.5">
              <Label>Cola que atiende</Label>
              <NativeSelect value={form.colaId ?? ""} onChange={(e) => setForm({ ...form, colaId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Todas las colas</option>
                {colas.map((c) => <option key={c.id} value={c.id}>{c.prefijo} · {c.nombre}</option>)}
              </NativeSelect>
            </div>
            <label className="flex items-center justify-between rounded-xl border p-3 text-sm">
              <span>Ventanilla activa</span>
              <Switch checked={form.activa} onCheckedChange={(v) => setForm({ ...form, activa: v })} />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbierto(false)}>Cancelar</Button>
            <Button onClick={guardar} disabled={guardando || form.nombre.length < 2}>{guardando && <Loader2 className="size-4 animate-spin" />} Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!borrar} onOpenChange={(o) => !o && setBorrar(null)} title={`¿Eliminar ${borrar?.nombre}?`} description="Si tiene turnos atendidos se desactivará para conservar el historial." confirmLabel="Eliminar" loading={guardando} onConfirm={eliminar} />
    </div>
  );
}
