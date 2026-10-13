"use client";

import { useCallback, useEffect, useState } from "react";
import { ListOrdered, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, EmptyState } from "@/components/app/page-header";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/fetcher";
import { fmtDuracion } from "@/lib/format";

interface Cola {
  id: number;
  prefijo: string;
  nombre: string;
  descripcion: string | null;
  activa: boolean;
  tiempoAtencionBase: number;
  orden: number;
  ventanillas: { id: number; nombre: string; activa: boolean }[];
  _count: { turnos: number };
}

const vacio = { prefijo: "", nombre: "", descripcion: "", tiempoAtencionBase: 300, activa: true, orden: 0 };

export function ColasAdmin() {
  const [colas, setColas] = useState<Cola[] | null>(null);
  const [form, setForm] = useState<typeof vacio & { id?: number }>(vacio);
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [borrar, setBorrar] = useState<Cola | null>(null);

  const cargar = useCallback(async () => {
    try {
      setColas(await api<Cola[]>("/api/v1/colas"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al cargar");
    }
  }, []);
  useEffect(() => void cargar(), [cargar]);

  function nuevo() {
    setForm({ ...vacio, orden: (colas?.length ?? 0) + 1 });
    setAbierto(true);
  }
  function editar(c: Cola) {
    setForm({ id: c.id, prefijo: c.prefijo, nombre: c.nombre, descripcion: c.descripcion ?? "", tiempoAtencionBase: c.tiempoAtencionBase, activa: c.activa, orden: c.orden });
    setAbierto(true);
  }

  async function guardar() {
    setGuardando(true);
    try {
      const { id, ...data } = form;
      if (id) await api(`/api/v1/colas/${id}`, { method: "PATCH", json: data });
      else await api("/api/v1/colas", { method: "POST", json: data });
      toast.success(id ? "Cola actualizada" : "Cola creada");
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
      const r = await api<{ desactivada?: boolean }>(`/api/v1/colas/${borrar.id}`, { method: "DELETE" });
      toast.success(r.desactivada ? "La cola tiene historial: se desactivó" : "Cola eliminada");
      setBorrar(null);
      await cargar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setGuardando(false);
    }
  }

  async function alternar(c: Cola) {
    try {
      await api(`/api/v1/colas/${c.id}`, { method: "PATCH", json: { activa: !c.activa } });
      await cargar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  }

  return (
    <div>
      <PageHeader title="Colas y servicios" description="Cada cola tiene un prefijo propio y numeración diaria independiente (RN01).">
        <Button onClick={nuevo}><Plus className="size-4" /> Nueva cola</Button>
      </PageHeader>

      {colas === null ? (
        <div className="space-y-2.5" aria-busy="true" aria-label="Cargando"><div className="skeleton h-12 rounded-2xl" /><div className="skeleton h-12 rounded-2xl opacity-80" /><div className="skeleton h-12 rounded-2xl opacity-60" /></div>
      ) : colas.length === 0 ? (
        <EmptyState icon={ListOrdered} title="Aún no hay colas" description="Crea la primera cola (por ejemplo, “A · Atención general”).">
          <Button onClick={nuevo}><Plus className="size-4" /> Nueva cola</Button>
        </EmptyState>
      ) : (
        <div className="rounded-2xl border bg-card shadow-soft">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Prefijo</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead className="hidden md:table-cell">Ventanillas</TableHead>
                <TableHead className="hidden md:table-cell">T. base</TableHead>
                <TableHead className="hidden sm:table-cell">Turnos</TableHead>
                <TableHead>Activa</TableHead>
                <TableHead className="w-24 text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {colas.map((c) => (
                <TableRow key={c.id}>
                  <TableCell><span className="inline-flex size-9 items-center justify-center rounded-lg bg-teal-600 font-mono font-bold text-white">{c.prefijo}</span></TableCell>
                  <TableCell>
                    <p className="font-medium">{c.nombre}</p>
                    {c.descripcion && <p className="text-xs text-muted-foreground">{c.descripcion}</p>}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {c.ventanillas.length === 0 && <span className="text-xs text-muted-foreground">Sin asignar</span>}
                      {c.ventanillas.map((v) => <Badge key={v.id} variant="outline">{v.nombre}</Badge>)}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell tabular">{fmtDuracion(c.tiempoAtencionBase)}</TableCell>
                  <TableCell className="hidden sm:table-cell tabular">{c._count.turnos.toLocaleString("es-PE")}</TableCell>
                  <TableCell><Switch checked={c.activa} onCheckedChange={() => alternar(c)} /></TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon-sm" onClick={() => editar(c)} title="Editar"><Pencil className="size-4" /></Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => setBorrar(c)} title="Eliminar" className="text-rose-600 hover:text-rose-700"><Trash2 className="size-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar cola" : "Nueva cola"}</DialogTitle>
            <DialogDescription>El prefijo forma el código del turno (ej. A-001). El tiempo base se usa hasta tener historial (RN02).</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-[88px_1fr] gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="prefijo">Prefijo</Label>
                <Input id="prefijo" value={form.prefijo} onChange={(e) => setForm({ ...form, prefijo: e.target.value.toUpperCase().slice(0, 3) })} placeholder="A" className="font-mono uppercase" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nombre">Nombre</Label>
                <Input id="nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Medicina General" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="desc">Descripción (opcional)</Label>
              <Textarea id="desc" value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} placeholder="Consulta médica general" rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tbase">Tiempo base (seg)</Label>
                <Input id="tbase" type="number" min={30} max={3600} value={form.tiempoAtencionBase} onChange={(e) => setForm({ ...form, tiempoAtencionBase: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="orden">Orden</Label>
                <Input id="orden" type="number" min={0} value={form.orden} onChange={(e) => setForm({ ...form, orden: Number(e.target.value) })} />
              </div>
            </div>
            <label className="flex items-center justify-between rounded-xl border p-3 text-sm">
              <span>Cola activa (visible para clientes)</span>
              <Switch checked={form.activa} onCheckedChange={(v) => setForm({ ...form, activa: v })} />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbierto(false)}>Cancelar</Button>
            <Button onClick={guardar} disabled={guardando || !form.prefijo || form.nombre.length < 2}>
              {guardando && <Loader2 className="size-4 animate-spin" />} Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!borrar}
        onOpenChange={(o) => !o && setBorrar(null)}
        title={`¿Eliminar la cola ${borrar?.prefijo} · ${borrar?.nombre}?`}
        description={borrar?._count.turnos ? "Tiene turnos registrados, por lo que se desactivará para conservar el historial y los reportes." : "Esta acción no se puede deshacer."}
        confirmLabel={borrar?._count.turnos ? "Desactivar" : "Eliminar"}
        loading={guardando}
        onConfirm={eliminar}
      />
    </div>
  );
}
