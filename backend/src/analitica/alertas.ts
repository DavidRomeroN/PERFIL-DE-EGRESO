import { prisma } from "@backend/db";
import { ErrorNegocio } from "@backend/errores";
import { publicar } from "@backend/realtime";
import { moduloActivo } from "@backend/modulos";
import { enviarAviso } from "@backend/notificaciones";
import { enviarCorreo, escaparHtml } from "@backend/correo";
import { contar, observar } from "@backend/metricas";
import { log } from "@backend/log";
import { fechaADate, fechaLocalISO, partesLocales } from "@backend/fechas";
import { estadoSla } from "@backend/analitica/consultas";
import { avanzarAlerta, esAnomalia, huella as calcularHuella, zRobusto, type Nivel } from "@backend/analitica/reglas";
import type { Alerta, Prisma, TipoAlerta } from "@backend/generated/prisma/client";

/** M7 · Motor de alertas (docs/modulos/M7-analitica-sla.md §6.5–6.6). La lógica de decisión vive en `reglas.ts`. */

const NIVELES_POR_DEFECTO: Nivel[] = [
  { traMin: 0, canales: ["IN_APP"] },
  { traMin: 10, canales: ["IN_APP", "WHATSAPP"] },
  { traMin: 30, canales: ["IN_APP", "CORREO"] },
];

export const REGLAS_POR_DEFECTO: { tipo: TipoAlerta; nombre: string; umbral: Record<string, unknown> }[] = [
  { tipo: "ESPERA_ALTA", nombre: "Espera máxima mayor a 20 min", umbral: { esperaMaxMin: 20 } },
  { tipo: "COLA_LARGA", nombre: "Más de 25 personas esperando", umbral: { enEspera: 25 } },
  { tipo: "SLA_INCUMPLIDO", nombre: "SLA por debajo del objetivo", umbral: {} },
  { tipo: "ANOMALIA_LLEGADAS", nombre: "Afluencia inusual", umbral: { z: 3.5 } },
  { tipo: "VENTANILLA_INACTIVA", nombre: "Ventanilla sin llamar con gente esperando", umbral: { minutos: 10 } },
  { tipo: "WHATSAPP_CAIDO", nombre: "WhatsApp sin poder enviar", umbral: { fallosSeguidos: 3 } },
  { tipo: "KIOSCO_OFFLINE", nombre: "Kiosco sin conexión", umbral: { segundos: 75 } },
];

export async function sembrarReglasAlerta(localId: number) {
  const existentes = await prisma.reglaAlerta.count({ where: { localId } });
  if (existentes) return 0;
  await prisma.reglaAlerta.createMany({
    data: REGLAS_POR_DEFECTO.map((r) => ({ localId, tipo: r.tipo, nombre: r.nombre, umbral: r.umbral as Prisma.InputJsonValue, niveles: NIVELES_POR_DEFECTO as unknown as Prisma.InputJsonValue })),
  });
  return REGLAS_POR_DEFECTO.length;
}

interface Observacion {
  entidad: string;
  dispara: boolean;
  titulo: string;
  detalle: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Medición por tipo (§6.6)
// ---------------------------------------------------------------------------
async function medir(regla: { tipo: TipoAlerta; umbral: unknown }, local: { id: number; zonaHoraria: string }, ahora: Date): Promise<Observacion[]> {
  const u = (regla.umbral ?? {}) as Record<string, number | undefined>;
  const fecha = fechaADate(fechaLocalISO(local.zonaHoraria, ahora));
  const colas = await prisma.cola.findMany({ where: { localId: local.id, activa: true, ...(u.colaId ? { id: u.colaId } : {}) }, select: { id: true, nombre: true } });

  switch (regla.tipo) {
    case "ESPERA_ALTA": {
      const lim = u.esperaMaxMin ?? 20;
      const out: Observacion[] = [];
      for (const c of colas) {
        const viejo = await prisma.turno.findFirst({ where: { colaId: c.id, fecha, estado: { in: ["EMITIDO", "AVISADO"] } }, orderBy: { emitidoAt: "asc" } });
        const min = viejo ? (ahora.getTime() - viejo.emitidoAt.getTime()) / 60000 : 0;
        out.push({ entidad: `cola:${c.id}`, dispara: min > lim, titulo: `Espera alta en ${c.nombre}`, detalle: { esperaMaxMin: Math.round(min), umbral: lim } });
      }
      return out;
    }
    case "COLA_LARGA": {
      const lim = u.enEspera ?? 25;
      const out: Observacion[] = [];
      for (const c of colas) {
        const n = await prisma.turno.count({ where: { colaId: c.id, fecha, estado: { in: ["EMITIDO", "AVISADO"] } } });
        out.push({ entidad: `cola:${c.id}`, dispara: n > lim, titulo: `Cola larga en ${c.nombre}`, detalle: { enEspera: n, umbral: lim } });
      }
      return out;
    }
    case "SLA_INCUMPLIDO": {
      const estado = await estadoSla(local.id, ahora);
      return estado
        .filter((s) => s.configurado && (!u.colaId || s.colaId === u.colaId))
        .map((s) => {
          const x = s as Extract<typeof s, { configurado: true }>;
          return {
            entidad: `cola:${x.colaId}`,
            dispara: x.muestra >= 10 && x.cumplimiento !== null && x.cumplimiento * 100 < x.objetivoPct,
            titulo: `SLA incumplido en ${x.cola}`,
            detalle: { cumplimientoPct: x.cumplimientoPct, objetivoPct: x.objetivoPct, muestra: x.muestra },
          };
        });
    }
    case "ANOMALIA_LLEGADAS": {
      const { diaSemana, hora, minuto } = partesLocales(local.zonaHoraria, ahora);
      const franja = hora * 2 + Math.floor(minuto / 30);
      const fraccion = (minuto % 30) / 30 || 1;
      const out: Observacion[] = [];
      for (const c of colas) {
        const base = await prisma.$queryRaw<{ llegadas: number }[]>`
          SELECT llegadas FROM mv_turno_franja
           WHERE cola_id = ${c.id}::int AND dow = ${diaSemana}::int AND franja = ${franja}::int
             AND fecha >= ${new Date(ahora.getTime() - 56 * 86400000)} AND fecha < ${fecha}`;
        const inicioFranja = new Date(ahora.getTime() - (minuto % 30) * 60000 - ahora.getSeconds() * 1000);
        const observado = await prisma.turno.count({ where: { colaId: c.id, emitidoAt: { gte: inicioFranja } } });
        // Las semanas sin llegadas en esa franja también son observaciones (0)
        const valores = base.map((b) => b.llegadas);
        while (valores.length < 8 && valores.length >= 4) valores.push(0);
        const z = zRobusto(valores, observado, fraccion);
        out.push({
          entidad: `cola:${c.id}`,
          dispara: esAnomalia(z, u.z ?? 3.5),
          titulo: z !== null && z > 0 ? `Afluencia inusualmente alta en ${c.nombre}` : `Caída de afluencia en ${c.nombre}`,
          detalle: { z: z === null ? null : Math.round(z * 10) / 10, observado, semanas: base.length },
        });
      }
      return out;
    }
    case "VENTANILLA_INACTIVA": {
      const min = u.minutos ?? 10;
      const vents = await prisma.ventanilla.findMany({ where: { localId: local.id, activa: true }, include: { cola: true } });
      const out: Observacion[] = [];
      for (const v of vents) {
        const usada = await prisma.turno.findFirst({ where: { ventanillaId: v.id, fecha }, orderBy: { llamadoAt: "desc" }, select: { llamadoAt: true, estado: true } });
        if (!usada) continue; // sin operador hoy: no se considera
        const espera = await prisma.turno.count({ where: { localId: local.id, fecha, estado: { in: ["EMITIDO", "AVISADO"] }, ...(v.colaId ? { colaId: v.colaId } : {}) } });
        const inactivaMin = usada.llamadoAt ? (ahora.getTime() - usada.llamadoAt.getTime()) / 60000 : 0;
        out.push({ entidad: `ventanilla:${v.id}`, dispara: espera > 0 && usada.estado !== "LLAMADO" && inactivaMin > min, titulo: `${v.nombre} sin llamar`, detalle: { minutos: Math.round(inactivaMin), enEspera: espera } });
      }
      return out;
    }
    case "WHATSAPP_CAIDO": {
      const n = u.fallosSeguidos ?? 3;
      const ult = await prisma.notificacion.findMany({ where: { localId: local.id, tipo: "WHATSAPP" }, orderBy: { id: "desc" }, take: n, select: { estado: true } });
      return [{ entidad: "whatsapp", dispara: ult.length >= n && ult.every((x) => x.estado === "FALLIDO"), titulo: "WhatsApp no está enviando", detalle: { fallosSeguidos: ult.filter((x) => x.estado === "FALLIDO").length } }];
    }
    case "KIOSCO_OFFLINE": {
      const seg = u.segundos ?? 75;
      const disps = await prisma.dispositivoKiosco.findMany({ where: { localId: local.id, activo: true, tokenHash: { not: null } } });
      return disps.map((d) => {
        const hace = d.ultimoHeartbeatAt ? (ahora.getTime() - d.ultimoHeartbeatAt.getTime()) / 1000 : Infinity;
        return { entidad: `kiosco:${d.id}`, dispara: hace > seg, titulo: `Kiosco K${d.numero} (${d.nombre}) sin conexión`, detalle: { segundosSinSenal: Number.isFinite(hace) ? Math.round(hace) : null } };
      });
    }
    default:
      return []; // PREDICCION_DERIVA, BALANCEO_LIMITE y JOB_FALLIDO llegan por evento (alertaDeSistema)
  }
}

// ---------------------------------------------------------------------------
// Ciclo de evaluación (cada minuto, por local con candado consultivo)
// ---------------------------------------------------------------------------
export async function evaluarLocal(localId: number, ahora = new Date()) {
  const t0 = performance.now();
  const local = await prisma.local.findUnique({ where: { id: localId }, select: { id: true, zonaHoraria: true } });
  if (!local) return { evaluadas: 0 };
  await sembrarReglasAlerta(localId);
  const reglas = await prisma.reglaAlerta.findMany({ where: { localId, activa: true } });
  let cambios = 0;
  for (const regla of reglas) {
    if (regla.silenciadaHasta && regla.silenciadaHasta > ahora) continue;
    let obs: Observacion[] = [];
    try {
      obs = await medir(regla, local, ahora);
    } catch (e) {
      log.warn("no se pudo medir la regla de alerta", { modulo: "M7", local_id: localId, regla: regla.id, error: String(e) });
      continue;
    }
    for (const o of obs) cambios += await aplicar(regla, localId, o, ahora);
  }
  // Alertas de sistema por evento: se resuelven solas tras 60 min sin repetirse
  const viejas = await prisma.alerta.findMany({
    where: { localId, estado: { in: ["ABIERTA", "RECONOCIDA"] }, tipo: { in: ["PREDICCION_DERIVA", "BALANCEO_LIMITE", "JOB_FALLIDO"] }, ultimaVezAt: { lt: new Date(ahora.getTime() - 60 * 60000) } },
  });
  for (const a of viejas) {
    await prisma.alerta.update({ where: { id: a.id }, data: { estado: "RESUELTA", resueltaAt: ahora } });
    emitir("alerta:actualizada", a.localId, { ...a, estado: "RESUELTA" });
    cambios++;
  }
  observar("m7_eval_ms", performance.now() - t0);
  return { evaluadas: reglas.length, cambios };
}

async function aplicar(regla: { id: number; tipo: TipoAlerta; niveles: unknown; resolverTrasMin: number }, localId: number, o: Observacion, ahora: Date) {
  const h = calcularHuella(regla.tipo, localId, o.entidad);
  const rachaFila = await prisma.alertaRacha.findUnique({ where: { huella: h } });
  const viva = await prisma.alerta.findFirst({ where: { huella: h, estado: { in: ["ABIERTA", "RECONOCIDA", "SILENCIADA"] } } });
  const ultima = viva ?? (await prisma.alerta.findFirst({ where: { huella: h, estado: "RESUELTA" }, orderBy: { resueltaAt: "desc" } }));
  const niveles = (Array.isArray(regla.niveles) ? regla.niveles : NIVELES_POR_DEFECTO) as Nivel[];
  const { racha, decision } = avanzarAlerta({
    dispara: o.dispara,
    ahoraMs: ahora.getTime(),
    racha: { disparos: rachaFila?.disparos ?? 0, normalDesdeMs: rachaFila?.normalDesde?.getTime() ?? null },
    alerta: ultima
      ? {
          estado: ultima.estado,
          nivel: ultima.nivel,
          primeraVezMs: ultima.primeraVezAt.getTime(),
          proximoEscalaMs: ultima.proximoEscalaAt?.getTime() ?? null,
          silenciadaHastaMs: ultima.silenciadaHasta?.getTime() ?? null,
          resueltaMs: ultima.resueltaAt?.getTime() ?? null,
        }
      : null,
    niveles,
    resolverTrasMin: regla.resolverTrasMin,
  });
  await prisma.alertaRacha.upsert({
    where: { huella: h },
    create: { huella: h, localId, disparos: racha.disparos, normalDesde: racha.normalDesdeMs ? new Date(racha.normalDesdeMs) : null },
    update: { disparos: racha.disparos, normalDesde: racha.normalDesdeMs ? new Date(racha.normalDesdeMs) : null, actualizadaAt: ahora },
  });

  switch (decision.tipo) {
    case "NADA":
      return 0;
    case "ABRIR": {
      try {
        const a = await prisma.alerta.create({
          data: { localId, reglaId: regla.id, tipo: regla.tipo, huella: h, entidad: o.entidad, nivel: 1, titulo: o.titulo, detalle: o.detalle as Prisma.InputJsonValue, primeraVezAt: ahora, ultimaVezAt: ahora, proximoEscalaAt: decision.proximoEscalaMs ? new Date(decision.proximoEscalaMs) : null },
        });
        contar("m7_alertas_total", { tipo: regla.tipo, nivel: 1 });
        emitir("alerta:nueva", localId, a);
        await notificar(a, niveles, 1);
      } catch (e) {
        // Índice único parcial: otra instancia ya la abrió (RN-M7-02)
        if (!(e instanceof Error && /Unique constraint|ux_alerta_huella_viva/.test(e.message))) throw e;
      }
      return 1;
    }
    case "REABRIR": {
      if (!ultima) return 0;
      const a = await prisma.alerta.update({ where: { id: ultima.id }, data: { estado: "ABIERTA", resueltaAt: null, ultimaVezAt: ahora, ocurrencias: { increment: 1 }, detalle: o.detalle as Prisma.InputJsonValue, proximoEscalaAt: decision.proximoEscalaMs ? new Date(decision.proximoEscalaMs) : null } });
      emitir("alerta:actualizada", localId, a);
      return 1;
    }
    case "REPETIR": {
      if (!viva) return 0;
      await prisma.alerta.update({ where: { id: viva.id }, data: { ultimaVezAt: ahora, ocurrencias: { increment: 1 }, detalle: o.detalle as Prisma.InputJsonValue } });
      return 0;
    }
    case "ESCALAR": {
      if (!viva) return 0;
      const a = await prisma.alerta.update({ where: { id: viva.id }, data: { nivel: decision.nivel, proximoEscalaAt: decision.proximoEscalaMs ? new Date(decision.proximoEscalaMs) : null, ultimaVezAt: ahora } });
      contar("m7_alertas_total", { tipo: regla.tipo, nivel: decision.nivel });
      emitir("alerta:actualizada", localId, a);
      await notificar(a, niveles, decision.nivel);
      return 1;
    }
    case "DESILENCIAR": {
      if (!viva) return 0;
      const a = await prisma.alerta.update({ where: { id: viva.id }, data: { estado: "ABIERTA", silenciadaHasta: null, ultimaVezAt: ahora } });
      emitir("alerta:actualizada", localId, a);
      return 1;
    }
    case "RESOLVER": {
      if (!viva) return 0;
      const a = await prisma.alerta.update({ where: { id: viva.id }, data: { estado: "RESUELTA", resueltaAt: ahora } });
      emitir("alerta:actualizada", localId, a);
      return 1;
    }
  }
}

function emitir(tipo: "alerta:nueva" | "alerta:actualizada", localId: number, a: Pick<Alerta, "id" | "titulo" | "nivel" | "estado">) {
  publicar({ tipo, localId, alerta: { id: String(a.id), titulo: a.titulo, nivel: a.nivel, estado: a.estado } });
}

/** Notifica por los canales del nivel; ≤ 1 por (alerta, nivel, canal) por hora (RN-M7-05). */
async function notificar(a: Alerta, niveles: Nivel[], nivel: number) {
  const def = niveles[nivel - 1];
  if (!def) return;
  const hora = new Date(Math.floor(Date.now() / 3600000) * 3600000);
  const local = await prisma.local.findUnique({ where: { id: a.localId }, include: { usuarios: { where: { rol: "ADMIN_LOCAL", activo: true } } } });
  if (!local) return;
  const texto = `🔔 [TurnoYa · ${local.nombreComercial}] ${a.titulo} (nivel ${nivel}). ${Object.entries(a.detalle as Record<string, unknown>).map(([k, v]) => `${k}: ${v}`).join(", ")}`;
  for (const canal of def.canales) {
    const r = await prisma.$executeRaw`INSERT INTO alerta_notificacion (alerta_id, nivel, canal, estado, hora) VALUES (${a.id}, ${nivel}::int, ${canal}, 'PENDIENTE', ${hora}) ON CONFLICT DO NOTHING`;
    if (Number(r) === 0) continue;
    let estado = "ENVIADO";
    let destino: string | null = null;
    if (canal === "WHATSAPP") {
      destino = local.telefono ?? null;
      const { normalizarTelefono } = await import("@backend/crypto");
      const tel = local.telefono ? normalizarTelefono(local.telefono) : null;
      if (tel) {
        const res = await enviarAviso({ localId: a.localId, telefonoE164: tel, plantilla: "alerta", texto });
        estado = res.via === "WHATSAPP" && res.ok ? "ENVIADO" : "WEB";
      } else estado = "SIN_DESTINO";
    } else if (canal === "CORREO") {
      const correos = local.usuarios.map((u) => u.email);
      destino = correos.join(", ");
      const res = await enviarCorreo({ para: correos, asunto: `[TurnoYa] ${a.titulo}`, texto, html: `<p>${escaparHtml(texto)}</p>` });
      estado = res.enviado ? "ENVIADO" : `NO_ENVIADO: ${res.error ?? ""}`.slice(0, 120);
    }
    await prisma.alertaNotificacion.updateMany({ where: { alertaId: a.id, nivel, canal, hora }, data: { estado, destino } });
    contar("m7_notificaciones_total", { canal, resultado: estado.startsWith("ENVIADO") ? "ok" : "no" });
  }
}

/** Alerta de sistema disparada por evento (deriva de M2, límite de M6, job fallido). */
export async function alertaDeSistema(localId: number, tipo: TipoAlerta, entidad: string, titulo: string, detalle: Record<string, unknown>) {
  if (!(await moduloActivo(localId, "M7"))) return null;
  const h = calcularHuella(tipo, localId, entidad);
  const viva = await prisma.alerta.findFirst({ where: { huella: h, estado: { in: ["ABIERTA", "RECONOCIDA", "SILENCIADA"] } } });
  if (viva) {
    await prisma.alerta.update({ where: { id: viva.id }, data: { ultimaVezAt: new Date(), ocurrencias: { increment: 1 }, detalle: detalle as Prisma.InputJsonValue } });
    return viva;
  }
  try {
    const a = await prisma.alerta.create({ data: { localId, tipo, huella: h, entidad, titulo, detalle: detalle as Prisma.InputJsonValue, proximoEscalaAt: new Date(Date.now() + 10 * 60000) } });
    emitir("alerta:nueva", localId, a);
    await notificar(a, NIVELES_POR_DEFECTO, 1);
    return a;
  } catch {
    return null;
  }
}

/** Job: evalúa todos los locales con M7 (un candado consultivo por local evita duplicados entre instancias). */
export async function jobEvaluarAlertas(ahora = new Date()) {
  const locales = await prisma.local.findMany({ where: { activo: true }, select: { id: true } });
  let evaluados = 0;
  for (const l of locales) {
    if (!(await moduloActivo(l.id, "M7"))) continue;
    await prisma.$transaction(async (tx) => {
      const lock = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${`alertas:${l.id}`})) AS ok`;
      if (!lock[0]?.ok) return;
      await evaluarLocal(l.id, ahora);
      evaluados++;
    }, { timeout: 60_000 });
  }
  return { evaluados };
}

// ---------------------------------------------------------------------------
// Acciones del admin (RF-M7-07)
// ---------------------------------------------------------------------------
export async function accionAlerta(localId: number, id: bigint, accion: "RECONOCER" | "RESOLVER" | "SILENCIAR" | "REABRIR", usuarioId: number, hasta?: Date) {
  const a = await prisma.alerta.findFirst({ where: { id, localId } });
  if (!a) throw new ErrorNegocio("M7_ALERTA_NO_ENCONTRADA", "La alerta no existe", 404);
  const ahora = new Date();
  let data: Prisma.AlertaUpdateInput;
  if (accion === "RECONOCER") {
    if (a.estado !== "ABIERTA") throw new ErrorNegocio("M7_ESTADO_INVALIDO", "Solo se reconoce una alerta abierta", 409);
    data = { estado: "RECONOCIDA", reconocidaPor: usuarioId, reconocidaAt: ahora, proximoEscalaAt: null };
  } else if (accion === "RESOLVER") {
    if (a.estado === "RESUELTA") throw new ErrorNegocio("M7_ESTADO_INVALIDO", "La alerta ya está resuelta", 409);
    data = { estado: "RESUELTA", resueltaAt: ahora };
  } else if (accion === "SILENCIAR") {
    if (!hasta || hasta <= ahora) throw new ErrorNegocio("VALIDACION", "Indica hasta cuándo silenciar", 422);
    if (a.estado === "RESUELTA") throw new ErrorNegocio("M7_ESTADO_INVALIDO", "La alerta ya está resuelta", 409);
    data = { estado: "SILENCIADA", silenciadaHasta: hasta, proximoEscalaAt: null };
  } else {
    if (a.estado !== "RESUELTA") throw new ErrorNegocio("M7_ESTADO_INVALIDO", "Solo se reabre una alerta resuelta", 409);
    const otra = await prisma.alerta.findFirst({ where: { huella: a.huella, estado: { in: ["ABIERTA", "RECONOCIDA", "SILENCIADA"] } } });
    if (otra) throw new ErrorNegocio("M7_ESTADO_INVALIDO", "Ya hay otra alerta viva para el mismo problema", 409);
    data = { estado: "ABIERTA", resueltaAt: null, ultimaVezAt: ahora };
  }
  const r = await prisma.alerta.update({ where: { id }, data });
  emitir("alerta:actualizada", localId, r);
  return r;
}

export function serializarAlerta(a: Alerta) {
  return { ...a, id: String(a.id) };
}
