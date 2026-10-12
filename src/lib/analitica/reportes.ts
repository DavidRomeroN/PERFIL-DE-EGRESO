import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { prisma } from "@/lib/db";
import { ErrorNegocio } from "@/lib/errores";
import { moduloActivo } from "@/lib/modulos";
import { enviarCorreo } from "@/lib/correo";
import { contar } from "@/lib/metricas";
import { log } from "@/lib/log";
import { fechaLocalISO, partesLocales } from "@/lib/fechas";
import { reporteEspera } from "@/lib/turnos";
import { csat, estadoSla, heatmap, percentiles } from "@/lib/analitica/consultas";
import { periodoQueToca, type Programacion } from "@/lib/analitica/reglas";

/** M7 · Reportes programados (§6.7): un archivo por (programación, periodo), PDF/CSV, envío por correo. */

const DIR = () => process.env.REPORTES_DIR ?? path.join(process.cwd(), ".reportes");

/** Las fuentes estándar de PDF usan WinAnsi: se reemplazan los caracteres que no puede dibujar. */
function ansi(s: string) {
  return s.replace(/[–—]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
}

export interface DatosReporte {
  local: string;
  titulo: string;
  desde: string;
  hasta: string;
  resumen: Awaited<ReturnType<typeof reporteEspera>>["resumen"];
  porCola: Awaited<ReturnType<typeof reporteEspera>>["porCola"];
  porHora: Awaited<ReturnType<typeof reporteEspera>>["porHora"];
  percentiles: Awaited<ReturnType<typeof percentiles>>;
  sla: Awaited<ReturnType<typeof estadoSla>>;
  csat: Awaited<ReturnType<typeof csat>>;
  heat: Awaited<ReturnType<typeof heatmap>>;
  alertas: { titulo: string; nivel: number; estado: string; ocurrencias: number }[];
}

export async function datosReporte(localId: number, desde: string, hasta: string, titulo: string): Promise<DatosReporte> {
  const local = await prisma.local.findUniqueOrThrow({ where: { id: localId } });
  const [rep, pct, sla, sat, heat, alertas] = await Promise.all([
    reporteEspera(localId, desde, hasta),
    percentiles(localId, desde, hasta, null, "cola"),
    estadoSla(localId),
    csat(localId, desde, hasta),
    heatmap(localId, desde, hasta, null, "llegadas"),
    prisma.alerta.findMany({ where: { localId, primeraVezAt: { gte: new Date(`${desde}T05:00:00Z`) } }, orderBy: { ocurrencias: "desc" }, take: 10 }),
  ]);
  return {
    local: local.nombreComercial,
    titulo,
    desde,
    hasta,
    resumen: rep.resumen,
    porCola: rep.porCola,
    porHora: rep.porHora,
    percentiles: pct,
    sla,
    csat: sat,
    heat,
    alertas: alertas.map((a) => ({ titulo: a.titulo, nivel: a.nivel, estado: a.estado, ocurrencias: a.ocurrencias })),
  };
}

/** PDF sin navegador: portada con KPIs, barras por hora, mapa de calor, percentiles, SLA, CSAT e incidentes. */
export async function generarPdf(d: DatosReporte) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${d.titulo} - ${d.local}`);
  pdf.setAuthor("TurnoYa");
  const fuente = await pdf.embedFont(StandardFonts.Helvetica);
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);
  const teal = rgb(15 / 255, 118 / 255, 110 / 255);
  const gris = rgb(0.4, 0.4, 0.4);
  let pagina = pdf.addPage([595, 842]);
  let y = 800;
  const texto = (t: string, x: number, size = 10, bold = false, color = rgb(0.1, 0.1, 0.1)) => pagina.drawText(ansi(t), { x, y, size, font: bold ? negrita : fuente, color });
  const nueva = () => {
    pagina = pdf.addPage([595, 842]);
    y = 800;
  };
  const espacio = (h: number) => {
    y -= h;
    if (y < 60) nueva();
  };

  // Portada / encabezado
  pagina.drawRectangle({ x: 0, y: 770, width: 595, height: 72, color: teal });
  pagina.drawText(ansi(d.titulo), { x: 40, y: 805, size: 20, font: negrita, color: rgb(1, 1, 1) });
  pagina.drawText(ansi(`${d.local} · ${d.desde} a ${d.hasta}`), { x: 40, y: 785, size: 11, font: fuente, color: rgb(1, 1, 1) });
  y = 740;

  // KPIs
  const kpis: [string, string][] = [
    ["Turnos", String(d.resumen.total)],
    ["Atendidos", String(d.resumen.atendidos)],
    ["Abandono", `${d.resumen.tasaAbandono}%`],
    ["Espera prom.", `${d.resumen.esperaPromMin} min`],
    ["Atención prom.", `${d.resumen.atencionPromMin} min`],
    ["CSAT", d.csat.promedio != null ? `${d.csat.promedio}/5` : "-"],
  ];
  kpis.forEach(([k, v], i) => {
    const x = 40 + (i % 3) * 175;
    const yy = y - Math.floor(i / 3) * 50;
    pagina.drawRectangle({ x, y: yy - 30, width: 160, height: 42, borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 1 });
    pagina.drawText(ansi(k), { x: x + 8, y: yy - 2, size: 9, font: fuente, color: gris });
    pagina.drawText(ansi(v), { x: x + 8, y: yy - 22, size: 16, font: negrita, color: teal });
  });
  espacio(120);

  // Barras por hora
  texto("Llegadas por hora", 40, 13, true);
  espacio(18);
  const maxH = Math.max(1, ...d.porHora.map((h) => h.turnos));
  const base = y - 110;
  d.porHora.forEach((h, i) => {
    const alto = (h.turnos / maxH) * 100;
    pagina.drawRectangle({ x: 45 + i * 32, y: base, width: 22, height: alto, color: teal });
    pagina.drawText(String(h.hora), { x: 49 + i * 32, y: base - 12, size: 8, font: fuente, color: gris });
  });
  espacio(140);

  // Mapa de calor
  texto("Mapa de calor: llegadas medias por día y hora", 40, 13, true);
  espacio(16);
  const maxV = Math.max(1, ...d.heat.matriz.flatMap((f) => f.celdas.map((c) => c.valor)));
  d.heat.horas.forEach((h, j) => pagina.drawText(String(h), { x: 80 + j * 30, y, size: 7, font: fuente, color: gris }));
  espacio(4);
  for (const fila of d.heat.matriz) {
    espacio(16);
    pagina.drawText(ansi(fila.dia), { x: 40, y: y + 3, size: 8, font: fuente });
    fila.celdas.forEach((c, j) => {
      const t = c.valor / maxV;
      pagina.drawRectangle({ x: 76 + j * 30, y, width: 28, height: 14, color: rgb(1 - t * 0.94, 1 - t * 0.54, 1 - t * 0.57) });
      if (c.valor > 0) pagina.drawText(String(c.valor), { x: 80 + j * 30, y: y + 4, size: 6, font: fuente, color: t > 0.5 ? rgb(1, 1, 1) : gris });
    });
  }
  espacio(26);

  // Percentiles
  texto("Percentiles de espera y atención (min)", 40, 13, true);
  espacio(16);
  texto("Cola", 40, 9, true);
  ["n", "Espera P50", "P90", "P95", "Atención P50", "P90"].forEach((h, i) => pagina.drawText(h, { x: 200 + i * 60, y, size: 9, font: negrita }));
  for (const p of d.percentiles) {
    espacio(14);
    texto(p.grupo.slice(0, 28), 40, 9);
    [p.n, p.espera.p50, p.espera.p90, p.espera.p95, p.atencion.p50, p.atencion.p90].forEach((v, i) => pagina.drawText(v == null ? "-" : String(v), { x: 200 + i * 60, y, size: 9, font: fuente }));
  }
  espacio(26);

  // SLA
  texto("SLA por cola (ventana móvil actual)", 40, 13, true);
  for (const s of d.sla) {
    espacio(14);
    if (!s.configurado) texto(`${s.cola}: sin SLA definido`, 40, 9, false, gris);
    else texto(`${s.cola}: ${s.cumplimientoPct ?? "-"}% (objetivo ${s.objetivoPct}% en ${s.esperaMaxMin} min) · ${s.cumple === null ? "sin muestras" : s.cumple ? "CUMPLE" : "NO CUMPLE"}`, 40, 9);
  }
  espacio(26);

  // CSAT
  texto("Satisfacción por tramo de espera", 40, 13, true);
  for (const t of d.csat.porTramo) {
    espacio(14);
    texto(`${t.tramo}: ${t.promedio ?? "-"} estrellas (n = ${t.n})`, 40, 9);
  }
  espacio(26);

  // Incidentes
  texto("Alertas del periodo", 40, 13, true);
  if (!d.alertas.length) {
    espacio(14);
    texto("Sin alertas.", 40, 9, false, gris);
  }
  for (const a of d.alertas) {
    espacio(14);
    texto(`${a.titulo} · nivel ${a.nivel} · ${a.estado} · ${a.ocurrencias} ocurrencias`, 40, 9);
  }

  const paginas = pdf.getPages();
  paginas.forEach((p, i) => p.drawText(`TurnoYa · página ${i + 1} de ${paginas.length}`, { x: 40, y: 25, size: 8, font: fuente, color: gris }));
  return Buffer.from(await pdf.save());
}

export function generarCsv(d: DatosReporte) {
  const filas = [["cola", "turnos", "atendidos", "abandonos", "tasa_abandono_pct", "espera_prom_min", "atencion_prom_min"]];
  for (const c of d.porCola) filas.push([c.cola, String(c.turnos), String(c.atendidos), String(c.abandonos), String(c.tasaAbandono), String(c.esperaPromMin), String(c.atencionPromMin)]);
  return filas.map((f) => f.map((x) => (/[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(",")).join("\n");
}

const TITULOS: Record<string, string> = {
  OPERATIVO_DIARIO: "Reporte operativo diario",
  SEMANAL_EJECUTIVO: "Reporte semanal ejecutivo",
  MENSUAL: "Reporte mensual",
};

/** Genera (una sola vez por periodo, RN-M7-07) y envía. `manual` permite volver a generar el periodo actual. */
export async function ejecutarReporte(programadoId: number, periodo: { periodo: string; desde: string; hasta: string }, manual = false) {
  const prog = await prisma.reporteProgramado.findUniqueOrThrow({ where: { id: programadoId }, include: { local: true } });
  const clave = manual ? `${periodo.periodo}-manual-${Date.now()}` : periodo.periodo;
  const r = await prisma.$executeRaw`INSERT INTO reporte_generado (programado_id, periodo, estado) VALUES (${programadoId}::int, ${clave}, 'GENERANDO') ON CONFLICT DO NOTHING`;
  if (Number(r) === 0) return null;
  try {
    const datos = await datosReporte(prog.localId, periodo.desde, periodo.hasta, TITULOS[prog.tipo] ?? prog.nombre);
    const dir = path.join(DIR(), String(prog.localId), periodo.desde.slice(0, 4));
    await mkdir(dir, { recursive: true });
    const adjuntos: { nombre: string; contenido: Buffer | string; tipo: string }[] = [];
    let archivo: string | null = null;
    let bytes = 0;
    if (prog.formato.includes("PDF")) {
      const pdf = await generarPdf(datos);
      archivo = path.join(dir, `${programadoId}-${clave}.pdf`);
      await writeFile(archivo, pdf);
      bytes += pdf.length;
      adjuntos.push({ nombre: `turnoya-${clave}.pdf`, contenido: pdf, tipo: "application/pdf" });
    }
    if (prog.formato.includes("CSV")) {
      const csv = generarCsv(datos);
      const ruta = path.join(dir, `${programadoId}-${clave}.csv`);
      await writeFile(ruta, csv, "utf8");
      archivo ??= ruta;
      bytes += Buffer.byteLength(csv);
      adjuntos.push({ nombre: `turnoya-${clave}.csv`, contenido: csv, tipo: "text/csv" });
    }
    const envio = await enviarCorreo({
      para: prog.destinatarios,
      asunto: `[TurnoYa] ${datos.titulo} · ${prog.local.nombreComercial} · ${periodo.periodo}`,
      texto: `Adjuntamos el ${datos.titulo.toLowerCase()} de ${prog.local.nombreComercial} (${periodo.desde} a ${periodo.hasta}).\nTurnos: ${datos.resumen.total} · Espera promedio: ${datos.resumen.esperaPromMin} min.`,
      adjuntos: bytes <= 5 * 1024 * 1024 ? adjuntos : [],
    });
    await prisma.reporteGenerado.update({
      where: { programadoId_periodo: { programadoId, periodo: clave } },
      data: { archivo: archivo ? path.relative(DIR(), archivo) : null, bytes, estado: envio.enviado ? "ENVIADO" : "GENERADO", error: envio.enviado ? null : envio.error },
    });
    await prisma.reporteProgramado.update({ where: { id: programadoId }, data: { ultimaEjecucionAt: new Date() } });
    contar("m7_reportes_total", { estado: envio.enviado ? "ENVIADO" : "GENERADO" });
    return { periodo: clave, enviado: envio.enviado, bytes };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.error("reporte fallido", { modulo: "M7", programado: programadoId, error });
    await prisma.reporteGenerado.update({ where: { programadoId_periodo: { programadoId, periodo: clave } }, data: { estado: "FALLIDO", error } }).catch(() => {});
    contar("m7_reportes_total", { estado: "FALLIDO" });
    return { periodo: clave, enviado: false, error };
  }
}

export async function jobReportes(ahora = new Date()) {
  const progs = await prisma.reporteProgramado.findMany({ where: { activo: true }, include: { local: true } });
  let generados = 0;
  for (const p of progs) {
    if (!(await moduloActivo(p.localId, "M7"))) continue;
    const zona = p.local.zonaHoraria;
    const { diaSemana, hora, minuto } = partesLocales(zona, ahora);
    const toca = periodoQueToca(p as unknown as Programacion, fechaLocalISO(zona, ahora), diaSemana, hora * 60 + minuto);
    if (!toca) continue;
    if (await ejecutarReporte(p.id, toca)) generados++;
  }
  return { generados };
}

export async function leerArchivo(localId: number, id: bigint) {
  const g = await prisma.reporteGenerado.findFirst({ where: { id, programado: { localId } } });
  if (!g?.archivo) throw new ErrorNegocio("M7_SIN_DATOS", "El reporte no tiene archivo", 404);
  const ruta = path.resolve(DIR(), g.archivo);
  if (!ruta.startsWith(path.resolve(DIR()))) throw new ErrorNegocio("PROHIBIDO", "Ruta inválida", 403);
  return { contenido: await readFile(ruta), nombre: path.basename(ruta), tipo: ruta.endsWith(".pdf") ? "application/pdf" : "text/csv" };
}

/** Limpieza (RN-M7-08): archivos > 90 días y alertas resueltas > 180 días. */
export async function jobLimpiarAnalitica() {
  const viejos = await prisma.reporteGenerado.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 90 * 86400000) } } });
  const alertas = await prisma.alerta.deleteMany({ where: { estado: "RESUELTA", resueltaAt: { lt: new Date(Date.now() - 180 * 86400000) } } });
  return { reportes: viejos.count, alertas: alertas.count };
}
