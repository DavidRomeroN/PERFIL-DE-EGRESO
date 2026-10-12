"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/fetcher";
import { cn } from "@/lib/utils";

/** Piezas compartidas por las pantallas de los módulos M1–M8 (estado de carga, error, pestañas, secciones). */

export function useDatos<T>(url: string | null, deps: unknown[] = []) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const recargar = useCallback(async () => {
    if (!url) return;
    setCargando(true);
    try {
      setDatos(await api<T>(url));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar");
    } finally {
      setCargando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);
  useEffect(() => {
    void recargar();
  }, [recargar]);
  return { datos, error, cargando, recargar, setDatos };
}

/** Ejecuta una acción con toast de éxito/error. Devuelve el resultado o null si falló. */
export async function accion<T>(fn: () => Promise<T>, exito?: string): Promise<T | null> {
  try {
    const r = await fn();
    if (exito) toast.success(exito);
    return r;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Ocurrió un error");
    return null;
  }
}

export function Pestanas<T extends string>({ valor, opciones, onCambio }: { valor: T; opciones: { valor: T; etiqueta: string; contador?: number }[]; onCambio: (v: T) => void }) {
  return (
    <div role="tablist" className="mb-5 inline-flex flex-wrap gap-1 rounded-xl bg-muted p-1">
      {opciones.map((o) => (
        <button
          key={o.valor}
          type="button"
          role="tab"
          aria-selected={valor === o.valor}
          onClick={() => onCambio(o.valor)}
          className={cn("min-h-9 rounded-lg px-3 text-sm font-medium text-muted-foreground transition", valor === o.valor && "bg-card text-foreground shadow-sm")}
        >
          {o.etiqueta}
          {o.contador ? <span className="ml-1.5 rounded-full bg-rose-600 px-1.5 text-[11px] text-white">{o.contador}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Seccion({ titulo, descripcion, children, acciones, className }: { titulo: string; descripcion?: string; children: React.ReactNode; acciones?: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border bg-card p-5 shadow-sm", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">{titulo}</h2>
          {descripcion && <p className="mt-0.5 text-sm text-muted-foreground">{descripcion}</p>}
        </div>
        {acciones && <div className="flex flex-wrap gap-2">{acciones}</div>}
      </div>
      {children}
    </section>
  );
}

export function Estado({ cargando, error, vacio, mensajeVacio, children }: { cargando: boolean; error: string | null; vacio?: boolean; mensajeVacio?: string; children: React.ReactNode }) {
  if (cargando) return <div className="h-24 animate-pulse rounded-xl bg-muted" aria-busy="true" />;
  if (error) return <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>;
  if (vacio) return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{mensajeVacio ?? "Sin datos todavía."}</p>;
  return <>{children}</>;
}

export function Kpi({ etiqueta, valor, pista, tono = "default" }: { etiqueta: string; valor: React.ReactNode; pista?: string; tono?: "default" | "bien" | "alerta" | "mal" }) {
  const tonos = { default: "text-foreground", bien: "text-emerald-700", alerta: "text-amber-700", mal: "text-rose-700" };
  return (
    <div className="rounded-2xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums", tonos[tono])}>{valor}</p>
      {pista && <p className="mt-0.5 text-xs text-muted-foreground">{pista}</p>}
    </div>
  );
}

export function Tabla({ columnas, filas, vacio }: { columnas: string[]; filas: React.ReactNode[][]; vacio?: string }) {
  if (!filas.length) return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{vacio ?? "Sin registros."}</p>;
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>{columnas.map((c) => <th key={c} scope="col" className="px-3 py-2 font-medium">{c}</th>)}</tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-t">
              {f.map((c, j) => <td key={j} className="px-3 py-2 align-top">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({ abierto, titulo, onCerrar, children }: { abierto: boolean; titulo: string; onCerrar: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (!abierto) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [abierto, onCerrar]);
  if (!abierto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onCerrar}>
      <div role="dialog" aria-modal="true" aria-label={titulo} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{titulo}</h2>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="rounded-lg px-2 py-1 text-muted-foreground hover:bg-muted">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function descargarCsv(nombre: string, filas: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const t = v == null ? "" : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const blob = new Blob(["﻿" + filas.map((f) => f.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const fmtHora = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Lima" }) : "—");
export const fmtFechaHora = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short", hour12: false, timeZone: "America/Lima" }) : "—");
