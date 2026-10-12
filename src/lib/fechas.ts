/** Utilidades de fecha. UTC en la BD; conversión a la zona del local (America/Lima) en el borde (ADR-04). */

export function fechaLocalISO(zona = "America/Lima", d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Fecha local (ISO yyyy-mm-dd) de hace N días. */
export function fechaLocalHaceDias(dias: number, zona = "America/Lima"): string {
  return fechaLocalISO(zona, new Date(Date.now() - dias * 86400000));
}

export function fechaADate(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`);
}

export function sumarDiasISO(iso: string, dias: number) {
  return new Date(fechaADate(iso).getTime() + dias * 86400000).toISOString().slice(0, 10);
}

/** Partes de la hora local de un instante: día de la semana (0 = domingo), hora y minuto. */
export function partesLocales(zona: string, d = new Date()) {
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: zona, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const wd = partes.find((p) => p.type === "weekday")?.value ?? "Mon";
  const mapa: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    diaSemana: mapa[wd] ?? 1,
    hora: Number(partes.find((p) => p.type === "hour")?.value ?? 0) % 24,
    minuto: Number(partes.find((p) => p.type === "minute")?.value ?? 0),
  };
}

/** Desfase (ms) de la zona respecto de UTC en un instante dado. Lima = −5 h. */
export function desfaseZona(zona: string, d = new Date()) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const v = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  const comoUtc = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour") % 24, v("minute"), v("second"));
  return comoUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** Instante UTC que corresponde a `fechaISO hh:mm` en la zona del local. */
export function instanteLocal(fechaISO: string, hh: number, mm: number, zona = "America/Lima") {
  const [y, m, d] = fechaISO.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  const off = desfaseZona(zona, new Date(guess));
  return new Date(guess - off);
}

/** "HH:MM" → minutos desde medianoche. */
export function minutosDe(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function horaLocal(d: Date, zona = "America/Lima") {
  return partesLocales(zona, d).hora;
}
