import type { EstadoTurno } from "@backend/generated/prisma/client";

export const ESTADO_LABEL: Record<EstadoTurno, string> = {
  EMITIDO: "En espera",
  AVISADO: "Avisado",
  LLAMADO: "Llamado",
  ATENDIDO: "Atendido",
  NO_SE_PRESENTO: "No se presentó",
  CANCELADO: "Cancelado",
  TRANSFERIDO: "Transferido",
};

export const ESTADO_CLASS: Record<EstadoTurno, string> = {
  EMITIDO: "bg-slate-100 text-slate-700 border-slate-200",
  AVISADO: "bg-amber-100 text-amber-800 border-amber-200",
  LLAMADO: "bg-teal-100 text-teal-800 border-teal-200",
  ATENDIDO: "bg-emerald-100 text-emerald-800 border-emerald-200",
  NO_SE_PRESENTO: "bg-rose-100 text-rose-800 border-rose-200",
  CANCELADO: "bg-zinc-100 text-zinc-600 border-zinc-200",
  TRANSFERIDO: "bg-indigo-100 text-indigo-800 border-indigo-200",
};

export const ROL_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Super administrador",
  ADMIN_LOCAL: "Administrador del local",
  OPERADOR: "Operador de ventanilla",
};

export function fmtDuracion(seg: number): string {
  if (!seg || seg <= 0) return "0 min";
  const min = Math.round(seg / 60);
  if (min < 1) return "< 1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function fmtMin(min: number): string {
  if (!min) return "0 min";
  if (min < 1) return "< 1 min";
  return `${Math.round(min * 10) / 10} min`;
}

export function fmtHora(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("es-PE", { hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" }).format(new Date(d));
}

export function fmtFechaHora(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" }).format(new Date(d));
}

export function fmtFecha(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("es-PE", { weekday: "short", day: "2-digit", month: "short" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

export function fmtFechaLarga(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("es-PE", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

export function haceCuanto(d: Date | string): string {
  const ms = Date.now() - new Date(d).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "hace un momento";
  if (min === 1) return "hace 1 min";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return h === 1 ? "hace 1 h" : `hace ${h} h`;
}

export function soles(n: number | string): string {
  return new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN", maximumFractionDigits: 0 }).format(Number(n));
}
