"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, Pencil, Plus, Trash2, Users } from "lucide-react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/fetcher";
import { fmtFechaHora, ROL_LABEL } from "@/lib/format";

interface Usuario {
  id: number;
  nombre: string;
  email: string;
  rol: "ADMIN_LOCAL" | "OPERADOR";
  activo: boolean;
  createdAt: string;
  ultimoAcceso: string | null;
}

type Form = { id?: number; nombre: string; email: string; password: string; rol: "ADMIN_LOCAL" | "OPERADOR"; activo: boolean };
const vacio: Form = { nombre: "", email: "", password: "", rol: "OPERADOR", activo: true };

export function UsuariosAdmin({ miId }: { miId: number }) {
  const [items, setItems] = useState<Usuario[] | null>(null);
  const [form, setForm] = useState<Form>(vacio);
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [borrar, setBorrar] = useState<Usuario | null>(null);

  const cargar = useCallback(async () => {
    try {
      setItems(await api<Usuario[]>("/api/v1/usuarios"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al cargar");
    }
  }, []);
  useEffect(() => void cargar(), [cargar]);

  async function guardar() {
    setGuardando(true);
    try {
      const { id, password, ...data } = form;
      const payload = password ? { ...data, password } : data;
      if (id) await api(`/api/v1/usuarios/${id}`, { method: "PATCH", json: payload });
      else await api("/api/v1/usuarios", { method: "POST", json: payload });
      toast.success(id ? "Usuario actualizado" : "Usuario creado");
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
      await api(`/api/v1/usuarios/${borrar.id}`, { method: "DELETE" });
      toast.success("Usuario eliminado");
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
      <PageHeader title="Usuarios" description="Cuentas del local: administradores (configuración y reportes) y operadores (panel de ventanilla).">
        <Button onClick={() => { setForm(vacio); setAbierto(true); }}><Plus className="size-4" /> Nuevo usuario</Button>
      </PageHeader>

      {items === null ? (
        <div className="space-y-2.5" aria-busy="true" aria-label="Cargando"><div className="skeleton h-12 rounded-2xl" /><div className="skeleton h-12 rounded-2xl opacity-80" /><div className="skeleton h-12 rounded-2xl opacity-60" /></div>
      ) : items.length === 0 ? (
        <EmptyState icon={Users} title="Sin usuarios" description="Crea cuentas para tu equipo." />
      ) : (
        <div className="rounded-2xl border bg-card shadow-soft">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead className="hidden md:table-cell">Último acceso</TableHead>
                <TableHead>Activo</TableHead>
                <TableHead className="w-24 text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <p className="font-medium">{u.nombre} {u.id === miId && <span className="text-xs text-muted-foreground">(tú)</span>}</p>
                    <p className="font-mono text-xs text-muted-foreground">{u.email}</p>
                  </TableCell>
                  <TableCell><Badge variant={u.rol === "ADMIN_LOCAL" ? "default" : "secondary"}>{ROL_LABEL[u.rol]}</Badge></TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{u.ultimoAcceso ? fmtFechaHora(u.ultimoAcceso) : "Nunca"}</TableCell>
                  <TableCell>
                    <Switch
                      checked={u.activo}
                      disabled={u.id === miId}
                      onCheckedChange={async (v) => {
                        await api(`/api/v1/usuarios/${u.id}`, { method: "PATCH", json: { activo: v } }).catch((e) => toast.error(e.message));
                        await cargar();
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon-sm" onClick={() => { setForm({ id: u.id, nombre: u.nombre, email: u.email, password: "", rol: u.rol, activo: u.activo }); setAbierto(true); }}><Pencil className="size-4" /></Button>
                    <Button variant="ghost" size="icon-sm" className="text-rose-600" disabled={u.id === miId} onClick={() => setBorrar(u)}><Trash2 className="size-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar usuario" : "Nuevo usuario"}</DialogTitle>
            <DialogDescription>Las contraseñas se guardan con bcrypt. {form.id && "Deja la contraseña vacía para no cambiarla."}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="unombre">Nombre</Label>
              <Input id="unombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Recepción · Ana Quispe" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="uemail">Correo</Label>
              <Input id="uemail" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="ana@local.pe" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="upass"><KeyRound className="size-3.5" /> Contraseña</Label>
                <Input id="upass" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={form.id ? "(sin cambios)" : "Mínimo 6"} />
              </div>
              <div className="space-y-1.5">
                <Label>Rol</Label>
                <NativeSelect value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value as Form["rol"] })}>
                  <option value="OPERADOR">Operador de ventanilla</option>
                  <option value="ADMIN_LOCAL">Administrador del local</option>
                </NativeSelect>
              </div>
            </div>
            <label className="flex items-center justify-between rounded-xl border p-3 text-sm">
              <span>Cuenta activa</span>
              <Switch checked={form.activo} disabled={form.id === miId} onCheckedChange={(v) => setForm({ ...form, activo: v })} />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbierto(false)}>Cancelar</Button>
            <Button onClick={guardar} disabled={guardando || form.nombre.length < 2 || !form.email || (!form.id && form.password.length < 6)}>
              {guardando && <Loader2 className="size-4 animate-spin" />} Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!borrar} onOpenChange={(o) => !o && setBorrar(null)} title={`¿Eliminar a ${borrar?.nombre}?`} description="Perderá el acceso de inmediato. Esta acción no se puede deshacer." confirmLabel="Eliminar" loading={guardando} onConfirm={eliminar} />
    </div>
  );
}
