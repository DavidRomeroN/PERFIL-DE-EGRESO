/**
 * F8 · Histórico sintético para M2 (entrenar), M7 (percentiles, mapa de calor, SLA) y M8 (calibrar/backtest).
 *
 *   npm run db:seed:historico -- --dias 60 --local policlinico-san-roman
 *
 * - Llegadas Poisson no homogéneas: curva por hora (picos 9–11 y 15–17) × factor por día de la semana.
 * - Atención log-normal por cola (media = tiempo_atencion_base, CV 0,5); ventanillas FIFO reales de la cola.
 * - 8 % no se presenta, 5 % cancela, categorías M1 (6 % adulto mayor, 4 % gestante, 3 % discapacidad).
 * - Valoraciones (más estrellas con menos espera) y citas atendidas. Semilla fija ⇒ reproducible.
 * Reemplaza los turnos de esos días del local (no toca los de hoy).
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { generarToken } from "../src/lib/crypto";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const DIAS = Number(arg("dias", "60"));
const SLUG = arg("local", "policlinico-san-roman");

let s = 20261013;
const rnd = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const normal = () => Math.sqrt(-2 * Math.log(Math.max(rnd(), 1e-12))) * Math.cos(2 * Math.PI * rnd());
const logNormal = (media: number, cv: number) => {
  const s2 = Math.log(1 + cv * cv);
  return Math.exp(Math.log(media) - s2 / 2 + Math.sqrt(s2) * normal());
};

/** Llegadas por hora (en hora punta) para una cola de referencia; se escala por cola. */
const CURVA: Record<number, number> = { 8: 10, 9: 18, 10: 20, 11: 16, 12: 10, 13: 8, 14: 10, 15: 15, 16: 16, 17: 12, 18: 8, 19: 5 };
const FACTOR_DIA = [0, 1.2, 1.0, 0.95, 1.0, 1.1, 0.6]; // domingo cerrado; lunes más concurrido

async function main() {
  const local = await prisma.local.findUnique({ where: { slug: SLUG }, include: { colas: { where: { activa: true }, include: { ventanillas: { where: { activa: true } } } }, categorias: true } });
  if (!local) throw new Error(`No existe el local ${SLUG}`);
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: local.zonaHoraria }).format(new Date());
  const fechas = Array.from({ length: DIAS }, (_, i) => new Date(Date.parse(`${hoy}T00:00:00Z`) - (DIAS - i) * 86400000).toISOString().slice(0, 10));
  const desde = new Date(`${fechas[0]}T00:00:00Z`);
  const hasta = new Date(`${hoy}T00:00:00Z`);

  console.log(`🧹 Quitando turnos de ${fechas[0]} a ${fechas[fechas.length - 1]} en ${local.nombreComercial}…`);
  const viejos = await prisma.turno.findMany({ where: { localId: local.id, fecha: { gte: desde, lt: hasta } }, select: { id: true } });
  const ids = viejos.map((t) => t.id);
  await prisma.cita.updateMany({ where: { turnoId: { in: ids } }, data: { turnoId: null } });
  await prisma.turno.updateMany({ where: { id: { in: ids } }, data: { citaId: null, sucesorId: null, transferidoDeTurnoId: null } });
  await prisma.turno.deleteMany({ where: { id: { in: ids } } });
  await prisma.contadorCola.deleteMany({ where: { cola: { localId: local.id }, fecha: { gte: desde, lt: hasta } } });

  // Datos sintéticos: no deben llenar la auditoría con miles de INSERT
  await prisma.$executeRawUnsafe("ALTER TABLE turno DISABLE TRIGGER trg_auditoria_turno");

  const cat = (codigo: string) => local.categorias.find((c) => c.codigo === codigo)?.id ?? null;
  const categorias = [
    { id: cat("ADULTO_MAYOR"), p: 0.06 },
    { id: cat("GESTANTE"), p: 0.04 },
    { id: cat("DISCAPACIDAD"), p: 0.03 },
  ];
  let total = 0;
  let valoraciones = 0;

  for (const cola of local.colas) {
    const c = Math.max(1, cola.ventanillas.length);
    const escala = ((c * 60) / (cola.tiempoAtencionBase / 60) / 20) * 0.97; // ~97 % de ocupación en hora punta: se forma cola en los picos
    const filas: Record<string, unknown>[] = [];
    const contadores: { colaId: number; fecha: Date; ultimoNumero: number }[] = [];
    for (const fecha of fechas) {
      const dow = new Date(`${fecha}T12:00:00Z`).getUTCDay();
      if (!FACTOR_DIA[dow]) continue;
      // Llegadas por adelgazamiento sobre 8:00–20:00 hora local (UTC−5)
      const llegadas: number[] = [];
      const lambdaMax = 20 * escala * FACTOR_DIA[dow];
      let t = 8 * 60;
      for (;;) {
        t += (-Math.log(1 - rnd()) * 60) / lambdaMax;
        if (t >= 20 * 60) break;
        const lam = (CURVA[Math.floor(t / 60)] ?? 0) * escala * FACTOR_DIA[dow];
        if (rnd() <= lam / lambdaMax) llegadas.push(t);
      }
      const libres = Array(c).fill(8 * 60);
      let numero = 0;
      for (const llegada of llegadas) {
        numero++;
        const emitido = new Date(Date.parse(`${fecha}T00:00:00Z`) + (llegada + 5 * 60) * 60000);
        const u = rnd();
        let categoriaId: number | null = null;
        let acum = 0;
        for (const k of categorias) {
          acum += k.p;
          if (u < acum && k.id) {
            categoriaId = k.id;
            break;
          }
        }
        const r = rnd();
        const canal = r < 0.55 ? "QR" : r < 0.75 ? "TICKET" : r < 0.88 ? "WHATSAPP" : r < 0.95 ? "KIOSCO" : "CITA";
        const destino = rnd();
        const base = { localId: local.id, colaId: cola.id, numero, codigo: `${cola.prefijo}-${String(numero).padStart(3, "0")}`, token: generarToken(10), canal, fecha: new Date(`${fecha}T00:00:00Z`), emitidoAt: emitido, categoriaId, delanteEmision: 0, ventanillasActivasEmision: c, prioridadVerificada: categoriaId ? true : null };
        if (destino < 0.05) {
          filas.push({ ...base, estado: "CANCELADO", finalizadoAt: new Date(emitido.getTime() + (5 + rnd() * 25) * 60000) });
          continue;
        }
        // Ventanilla que se libera primero (FIFO); las preferentes ganan algo de tiempo
        const v = libres.indexOf(Math.min(...libres));
        const inicio = Math.max(llegada, libres[v]) - (categoriaId ? Math.min(5, Math.max(0, libres[v] - llegada) * 0.4) : 0);
        const enCola = libres.filter((x) => x > llegada).length;
        base.delanteEmision = Math.max(0, Math.round((libres[v] - llegada) / (cola.tiempoAtencionBase / 60)) * c + enCola - c);
        const llamado = new Date(Date.parse(`${fecha}T00:00:00Z`) + (Math.max(inicio, llegada) + 5 * 60) * 60000);
        const ventanillaId = cola.ventanillas[v]?.id ?? null;
        if (destino < 0.13) {
          libres[v] = Math.max(inicio, llegada) + 3; // RN04: la ventanilla pierde 3 min
          filas.push({ ...base, estado: "NO_SE_PRESENTO", ventanillaId, avisadoAt: llamado, llamadoAt: llamado, finalizadoAt: new Date(llamado.getTime() + 3 * 60000) });
          continue;
        }
        const servicio = logNormal(cola.tiempoAtencionBase / 60, 0.5);
        libres[v] = Math.max(inicio, llegada) + servicio;
        const fin = new Date(llamado.getTime() + servicio * 60000);
        filas.push({ ...base, estado: "ATENDIDO", ventanillaId, avisadoAt: llamado, llamadoAt: llamado, atendidoAt: llamado, finalizadoAt: fin });
      }
      contadores.push({ colaId: cola.id, fecha: new Date(`${fecha}T00:00:00Z`), ultimoNumero: numero });
    }
    for (let i = 0; i < filas.length; i += 500) await prisma.turno.createMany({ data: filas.slice(i, i + 500) as never });
    await prisma.contadorCola.createMany({ data: contadores, skipDuplicates: true });
    total += filas.length;

    // Valoraciones (~18 % de los atendidos): más estrellas con menos espera
    const atendidos = await prisma.turno.findMany({ where: { colaId: cola.id, estado: "ATENDIDO", fecha: { gte: desde, lt: hasta } }, select: { id: true, emitidoAt: true, llamadoAt: true } });
    const vals = atendidos.filter(() => rnd() < 0.18).map((a) => {
      const espera = (a.llamadoAt!.getTime() - a.emitidoAt.getTime()) / 60000;
      const estrellas = Math.max(1, Math.min(5, Math.round(5 - espera / 12 + normal() * 0.7)));
      return { turnoId: a.id, estrellas, comentario: estrellas <= 2 && rnd() < 0.4 ? "Demoró mucho la atención" : estrellas === 5 && rnd() < 0.2 ? "Muy rápido, gracias" : null };
    });
    await prisma.valoracion.createMany({ data: vals, skipDuplicates: true });
    valoraciones += vals.length;
    console.log(`  ${cola.nombre}: ${filas.length} turnos, ${vals.length} valoraciones`);
  }

  await prisma.$executeRawUnsafe("ALTER TABLE turno ENABLE TRIGGER trg_auditoria_turno");
  console.log("🔄 Refrescando la vista de analítica…");
  await prisma.$executeRawUnsafe("REFRESH MATERIALIZED VIEW mv_turno_franja");
  console.log(`✅ Histórico listo: ${total} turnos en ${DIAS} días, ${valoraciones} valoraciones. Ahora puedes reentrenar M2 (Admin → Predicción).`);
}

main()
  .catch(async (e) => {
    await prisma.$executeRawUnsafe("ALTER TABLE turno ENABLE TRIGGER trg_auditoria_turno").catch(() => {});
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
