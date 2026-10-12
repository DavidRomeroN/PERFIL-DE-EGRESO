import { createHmac } from "crypto";
import { instanteLocal, minutosDe } from "@/lib/fechas";

/** M3 · Reglas puras de citas (docs/modulos/M3-citas-reservas.md §6). Sin I/O. */

export type EstadoCita = "RESERVADA" | "CONFIRMADA" | "CHECKIN" | "ATENDIDA" | "NO_SHOW" | "CANCELADA";

/** §6.4 Máquina de estados de la cita. */
export const TRANSICIONES_CITA: Record<EstadoCita, EstadoCita[]> = {
  RESERVADA: ["CONFIRMADA", "CHECKIN", "CANCELADA", "NO_SHOW", "ATENDIDA"],
  CONFIRMADA: ["CHECKIN", "CANCELADA", "NO_SHOW", "ATENDIDA"],
  CHECKIN: ["ATENDIDA", "NO_SHOW"],
  ATENDIDA: [],
  NO_SHOW: [],
  CANCELADA: [],
};

export function transicionCitaValida(desde: EstadoCita, hacia: EstadoCita) {
  return TRANSICIONES_CITA[desde].includes(hacia);
}

export interface ConfigVentana {
  checkinAntesMin: number;
  checkinDespuesMin: number;
  graciaNoShowMin: number;
}

export type ResultadoVentana =
  | { tipo: "TEMPRANO"; disponibleDesde: Date }
  | { tipo: "DENTRO" }
  | { tipo: "TARDE" }
  | { tipo: "VENCIDA" };

/** §6.5: ventana de check-in (−10/+15 por defecto) y gracia para entrar tarde como turno general. */
export function ventanaCheckin(inicio: Date, ahora: Date, cfg: ConfigVentana): ResultadoVentana {
  const t = ahora.getTime();
  const ini = inicio.getTime();
  const desde = ini - cfg.checkinAntesMin * 60000;
  const hasta = ini + cfg.checkinDespuesMin * 60000;
  const gracia = hasta + cfg.graciaNoShowMin * 60000;
  if (t < desde) return { tipo: "TEMPRANO", disponibleDesde: new Date(desde) };
  if (t <= hasta) return { tipo: "DENTRO" };
  if (t <= gracia) return { tipo: "TARDE" };
  return { tipo: "VENCIDA" };
}

/** RN-M3-05: llegar temprano no adelanta a nadie ⇒ emitido_at = max(ahora, inicio). */
export function emisionDeCita(inicio: Date, ahora: Date, tarde: boolean) {
  return tarde ? ahora : new Date(Math.max(ahora.getTime(), inicio.getTime()));
}

/** RF-M3-02: capacidad = capacidadFija ?? max(1, floor(ventanillas × cuota%)). */
export function capacidadSlot(ventanillas: number, cuotaPct: number, capacidadFija?: number | null) {
  if (capacidadFija != null && capacidadFija > 0) return capacidadFija;
  return Math.max(1, Math.floor((ventanillas * cuotaPct) / 100));
}

export interface Tramo {
  apertura: string;
  cierre: string;
}

export interface Bloqueo {
  inicio: Date;
  fin: Date;
}

/** §6.1: franjas del día a partir del horario, menos bloqueos y lo que ya pasó. */
export function franjasDelDia(fechaISO: string, tramos: Tramo[], duracionMin: number, zona: string, bloqueos: Bloqueo[], ahora: Date) {
  const salida: { inicio: Date; fin: Date }[] = [];
  for (const t of tramos) {
    const ini = minutosDe(t.apertura);
    const fin = minutosDe(t.cierre);
    for (let m = ini; m + duracionMin <= fin; m += duracionMin) {
      const inicio = instanteLocal(fechaISO, Math.floor(m / 60), m % 60, zona);
      const termino = new Date(inicio.getTime() + duracionMin * 60000);
      if (inicio <= ahora) continue;
      if (bloqueos.some((b) => inicio < b.fin && termino > b.inicio)) continue;
      salida.push({ inicio, fin: termino });
    }
  }
  return salida.sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
}

/** RN-M3-02: anticipación mínima y máxima. */
export function dentroDeAnticipacion(inicio: Date, ahora: Date, minMin: number, maxDias: number) {
  const dif = inicio.getTime() - ahora.getTime();
  return dif >= minMin * 60000 && dif <= maxDias * 86400000;
}

/** RN-M3-06: bloqueo por reincidencia. */
export function debeBloquear(noShows90d: number, maxNoShow: number) {
  return maxNoShow > 0 && noShows90d >= maxNoShow;
}

// ---------------------------------------------------------------------------
// PIN de presencia (§6.5): HMAC-SHA256(secreto, localId ‖ ventana de 5 min) → 4 dígitos.
// ---------------------------------------------------------------------------
export const VENTANA_PIN_MS = 5 * 60_000;

export function pinPresencia(secreto: string, localId: number, ventana: number) {
  const h = createHmac("sha256", secreto).update(`${localId}:${ventana}`).digest();
  const n = h.readUInt32BE(h[h.length - 1] & 0x0f) & 0x7fffffff;
  return String(n % 10000).padStart(4, "0");
}

export function ventanaPin(ahoraMs: number) {
  return Math.floor(ahoraMs / VENTANA_PIN_MS);
}

/** Acepta el PIN de la ventana actual y el de la anterior (tolerancia de reloj). */
export function validarPin(secreto: string, localId: number, pin: string, ahoraMs: number) {
  const v = ventanaPin(ahoraMs);
  return [v, v - 1].some((w) => pinPresencia(secreto, localId, w) === pin.trim());
}

export function segundosRestantesPin(ahoraMs: number) {
  return Math.ceil((VENTANA_PIN_MS - (ahoraMs % VENTANA_PIN_MS)) / 1000);
}

// ---------------------------------------------------------------------------
// .ics (§6.8)
// ---------------------------------------------------------------------------
function escaparIcs(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function fechaIcsLocal(d: Date, zona: string) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${v("year")}${v("month")}${v("day")}T${v("hour")}${v("minute")}${v("second")}`;
}

function fechaIcsUtc(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function generarIcs(c: { id: number; inicio: Date; fin: Date; local: string; servicio: string; direccion?: string | null; url: string; zona: string }) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TurnoYa//Citas//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE",
    `TZID:${c.zona}`,
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0500",
    "TZNAME:-05",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:cita-${c.id}@turnoya.pe`,
    `DTSTAMP:${fechaIcsUtc(new Date())}`,
    `DTSTART;TZID=${c.zona}:${fechaIcsLocal(c.inicio, c.zona)}`,
    `DTEND;TZID=${c.zona}:${fechaIcsLocal(c.fin, c.zona)}`,
    `SUMMARY:${escaparIcs(`Cita en ${c.local} (${c.servicio})`)}`,
    c.direccion ? `LOCATION:${escaparIcs(c.direccion)}` : "",
    `URL:${c.url}`,
    `DESCRIPTION:${escaparIcs(`Al llegar haz check-in desde ${c.url}`)}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    "DESCRIPTION:Recordatorio de tu cita",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}

/** Código corto de check-in (6 caracteres sin ambiguos). */
export function codigoCheckin(aleatorio: (n: number) => string) {
  return aleatorio(6);
}
