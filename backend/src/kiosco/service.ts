import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { prisma } from "@backend/db";
import { ErrorNegocio } from "@backend/errores";
import { publicar } from "@backend/realtime";
import { cifrar, normalizarTelefono } from "@backend/crypto";
import { exigirModulo, moduloActivo } from "@backend/modulos";
import { contar, observar } from "@backend/metricas";
import { log } from "@backend/log";
import { fechaLocalISO } from "@backend/fechas";
import { codigoProvisional, corregirTiempo, validarEvento } from "@backend/kiosco/reglas";
import type { Prisma } from "@backend/generated/prisma/client";

/** M5 · Kiosco offline-first: dispositivos, emparejamiento, heartbeat, emisión idempotente y sincronización. */

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const MAX_DISPOSITIVOS = 3;
const VENTANA_OFFLINE_H = Number(process.env.KIOSCO_VENTANA_OFFLINE_H ?? 12);

// ---------------------------------------------------------------------------
// Administración de dispositivos (§6.6)
// ---------------------------------------------------------------------------
export async function crearDispositivo(localId: number, nombre: string, colaIds: number[]) {
  await exigirModulo(localId, "M5");
  const n = await prisma.dispositivoKiosco.count({ where: { localId, activo: true } });
  if (n >= MAX_DISPOSITIVOS) throw new ErrorNegocio("M5_LIMITE_DISPOSITIVOS", `El plan permite hasta ${MAX_DISPOSITIVOS} kioscos`, 402);
  await validarColas(localId, colaIds);
  const numero = ((await prisma.dispositivoKiosco.aggregate({ where: { localId }, _max: { numero: true } }))._max.numero ?? 0) + 1;
  const pin = String(randomBytes(2).readUInt16BE(0) % 9000 + 1000);
  const d = await prisma.dispositivoKiosco.create({ data: { localId, numero, nombre, colaIds, pinMantenimiento: sha(pin) } });
  // El PIN de mantenimiento se muestra una sola vez al admin; en la BD queda solo su hash
  return { dispositivo: vista(d), pinMantenimiento: pin, ...(await nuevoCodigo(d.id)) };
}

async function validarColas(localId: number, colaIds: number[]) {
  if (!colaIds.length) return;
  const n = await prisma.cola.count({ where: { localId, id: { in: colaIds } } });
  if (n !== colaIds.length) throw new ErrorNegocio("VALIDACION", "Alguna cola no pertenece al local", 422);
}

/** Código de emparejamiento de 6 dígitos, un solo uso, 10 min; se guarda solo su hash. */
export async function nuevoCodigo(dispositivoId: number) {
  const codigo = String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
  const expira = new Date(Date.now() + 10 * 60000);
  await prisma.dispositivoKiosco.update({ where: { id: dispositivoId }, data: { codigoEmparejHash: sha(codigo), codigoEmparejExpira: expira } });
  return { codigo, expira };
}

export async function editarDispositivo(localId: number, id: number, d: { nombre?: string; colaIds?: number[]; activo?: boolean; pin?: string }) {
  const disp = await prisma.dispositivoKiosco.findFirst({ where: { id, localId } });
  if (!disp) throw new ErrorNegocio("NO_ENCONTRADO", "El kiosco no existe", 404);
  if (d.colaIds) await validarColas(localId, d.colaIds);
  const r = await prisma.dispositivoKiosco.update({
    where: { id },
    data: {
      ...(d.nombre ? { nombre: d.nombre } : {}),
      ...(d.colaIds ? { colaIds: d.colaIds } : {}),
      ...(d.activo !== undefined ? { activo: d.activo, ...(d.activo ? {} : { tokenHash: null, enLinea: false }) } : {}),
      ...(d.pin ? { pinMantenimiento: sha(d.pin) } : {}),
      configVersion: { increment: 1 },
    },
  });
  return vista(r);
}

/** Rota el token: el kiosco debe volver a emparejarse con el código nuevo. */
export async function rotar(localId: number, id: number) {
  const disp = await prisma.dispositivoKiosco.findFirst({ where: { id, localId } });
  if (!disp) throw new ErrorNegocio("NO_ENCONTRADO", "El kiosco no existe", 404);
  await prisma.dispositivoKiosco.update({ where: { id }, data: { tokenHash: null, enLinea: false, activo: true } });
  return nuevoCodigo(id);
}

function vista(d: { id: number; numero: number; nombre: string; colaIds: number[]; activo: boolean; tokenHash: string | null; versionApp: string | null; ultimoHeartbeatAt: Date | null; offsetRelojMs: number; pendientesReportados: number; impresora: string | null; enLinea: boolean; codigoEmparejExpira: Date | null }) {
  const hace = d.ultimoHeartbeatAt ? (Date.now() - d.ultimoHeartbeatAt.getTime()) / 1000 : null;
  return {
    id: d.id,
    numero: d.numero,
    prefijo: `K${d.numero}`,
    nombre: d.nombre,
    colaIds: d.colaIds,
    activo: d.activo,
    emparejado: !!d.tokenHash,
    versionApp: d.versionApp,
    ultimoHeartbeatAt: d.ultimoHeartbeatAt,
    enLinea: d.activo && !!d.tokenHash && hace !== null && hace <= 75,
    relojDesfasado: Math.abs(d.offsetRelojMs) > 120_000,
    offsetRelojMs: d.offsetRelojMs,
    pendientes: d.pendientesReportados,
    impresora: d.impresora,
    codigoVigenteHasta: d.codigoEmparejExpira && d.codigoEmparejExpira > new Date() ? d.codigoEmparejExpira : null,
  };
}

export async function listarDispositivos(localId: number) {
  return (await prisma.dispositivoKiosco.findMany({ where: { localId }, orderBy: { numero: "asc" } })).map(vista);
}

// ---------------------------------------------------------------------------
// Autenticación del dispositivo (token Bearer, solo /kiosco/*)
// ---------------------------------------------------------------------------
export async function autenticar(req: NextRequest) {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (token.length < 20) throw new ErrorNegocio("M5_DISPOSITIVO_NO_AUTORIZADO", "Dispositivo no autorizado", 401);
  const d = await prisma.dispositivoKiosco.findFirst({ where: { tokenHash: sha(token), activo: true }, include: { local: true } });
  if (!d) throw new ErrorNegocio("M5_DISPOSITIVO_NO_AUTORIZADO", "Dispositivo no autorizado", 401);
  if (!(await moduloActivo(d.localId, "M5"))) throw new ErrorNegocio("MODULO_NO_DISPONIBLE", "El kiosco no está activo en este local", 403);
  return d;
}

/** POST /kiosco/emparejar: canjea el código por un token (32 bytes) del que solo se guarda el hash. */
export async function emparejar(codigo: string) {
  const limpio = codigo.replace(/\D/g, "");
  if (limpio.length !== 6) throw new ErrorNegocio("M5_CODIGO_INVALIDO", "El código tiene 6 dígitos", 403);
  const hash = sha(limpio);
  const candidatos = await prisma.dispositivoKiosco.findMany({ where: { codigoEmparejHash: { not: null }, activo: true } });
  const d = candidatos.find((c) => {
    const a = Buffer.from(c.codigoEmparejHash!);
    const b = Buffer.from(hash);
    return a.length === b.length && timingSafeEqual(a, b);
  });
  if (!d) throw new ErrorNegocio("M5_CODIGO_INVALIDO", "El código no es válido", 403);
  if (!d.codigoEmparejExpira || d.codigoEmparejExpira < new Date()) throw new ErrorNegocio("M5_CODIGO_EXPIRADO", "El código expiró; genera otro desde el admin", 410);
  const token = randomBytes(32).toString("base64url");
  await prisma.dispositivoKiosco.update({ where: { id: d.id }, data: { tokenHash: sha(token), codigoEmparejHash: null, codigoEmparejExpira: null, enLinea: true, ultimoHeartbeatAt: new Date() } });
  log.info("kiosco emparejado", { modulo: "M5", local_id: d.localId, dispositivo: d.id });
  return { dispositivoId: d.id, numero: d.numero, token, config: await configDispositivo(d.id) };
}

export async function configDispositivo(dispositivoId: number) {
  const d = await prisma.dispositivoKiosco.findUniqueOrThrow({ where: { id: dispositivoId }, include: { local: true } });
  const colas = await prisma.cola.findMany({ where: { localId: d.localId, activa: true, ...(d.colaIds.length ? { id: { in: d.colaIds } } : {}) }, orderBy: { orden: "asc" }, select: { id: true, nombre: true, prefijo: true, descripcion: true } });
  const M1 = await moduloActivo(d.localId, "M1");
  const M3 = await moduloActivo(d.localId, "M3");
  const categorias = M1 ? await prisma.categoriaPrioridad.findMany({ where: { localId: d.localId, activa: true, visibleCliente: true, codigo: { not: "GENERAL" } }, orderBy: { orden: "asc" }, select: { codigo: true, nombre: true, documento: true } }) : [];
  const { localAbierto } = await import("@backend/operacion");
  const horario = await localAbierto(d.localId, d.local.zonaHoraria);
  return {
    version: d.configVersion,
    dispositivo: { id: d.id, numero: d.numero, nombre: d.nombre },
    local: { nombre: d.local.nombreComercial, color: d.local.colorPrimario, logoUrl: d.local.logoUrl, slug: d.local.slug },
    colas,
    categorias,
    citas: M3,
    abierto: horario.abierto,
    mensajeCerrado: horario.mensaje,
    inactividadSeg: 30,
    ventanaOfflineHoras: VENTANA_OFFLINE_H,
    textos: { consentimiento: "Al dejar tu celular aceptas que lo usemos solo para avisarte de tu turno (Ley 29733). Se borra a los 90 días." },
  };
}

/** Heartbeat cada 20 s: guarda estado y desfase; responde la hora del servidor (§6.5). */
export async function heartbeat(dispositivoId: number, d: { estado?: string; pendientes?: number; version?: string; impresora?: string; offsetMs?: number }) {
  const previo = await prisma.dispositivoKiosco.findUniqueOrThrow({ where: { id: dispositivoId } });
  const r = await prisma.dispositivoKiosco.update({
    where: { id: dispositivoId },
    data: { ultimoHeartbeatAt: new Date(), enLinea: true, pendientesReportados: d.pendientes ?? 0, versionApp: d.version ?? null, impresora: d.impresora ?? null, ...(typeof d.offsetMs === "number" ? { offsetRelojMs: Math.round(d.offsetMs) } : {}) },
  });
  if (!previo.enLinea) publicar({ tipo: "kiosco:estado", localId: r.localId, dispositivoId, enLinea: true });
  return { serverTime: new Date().toISOString(), configVersion: r.configVersion, relojDesfasado: Math.abs(r.offsetRelojMs) > 120_000 };
}

// ---------------------------------------------------------------------------
// Emisión online y sincronización (§6.4)
// ---------------------------------------------------------------------------
export interface EventoEntrada {
  claveIdem: string;
  seq: number;
  tipo: "EMITIR_TURNO" | "CHECKIN_CITA";
  tsDispositivo: string;
  offsetMsAlEmitir: number;
  payload: { colaId?: number; categoria?: string | null; nombre?: string | null; telefono?: string | null; consentimiento?: boolean; codigoCita?: string };
}

type Resultado =
  | { claveIdem: string; estado: "APLICADO" | "DUPLICADO"; turno: { codigo: string; token: string; posicion?: number } }
  | { claveIdem: string; estado: "REVISION" | "RECHAZADO"; motivo: string };

async function resultadoExistente(claveIdem: string): Promise<Resultado | null> {
  const e = await prisma.eventoKiosco.findUnique({ where: { claveIdem } });
  if (!e) return null;
  if ((e.estado === "APLICADO" || e.estado === "DUPLICADO") && e.turnoId) {
    const t = await prisma.turno.findUnique({ where: { id: e.turnoId }, select: { codigo: true, token: true } });
    if (t) return { claveIdem, estado: e.estado === "APLICADO" ? "DUPLICADO" : "DUPLICADO", turno: t };
  }
  if (e.estado === "PENDIENTE") return null;
  return { claveIdem, estado: e.estado === "REVISION" ? "REVISION" : "RECHAZADO", motivo: e.motivo ?? "REVISION" };
}

/** Aplica un evento (cada uno en su propia transacción lógica). Idempotente por `claveIdem`. */
export async function aplicarEvento(disp: { id: number; localId: number; numero: number; colaIds: number[]; offsetRelojMs: number; ultimoHeartbeatAt: Date | null; local: { zonaHoraria: string } }, ev: EventoEntrada, ahora = new Date()): Promise<Resultado> {
  if (!/^[0-9a-f-]{20,64}$/i.test(ev.claveIdem)) return { claveIdem: ev.claveIdem, estado: "RECHAZADO", motivo: "M5_EVENTO_INVALIDO" };
  const payloadSeguro: Record<string, unknown> = {
    colaId: ev.payload.colaId ?? null,
    categoria: ev.payload.categoria ?? null,
    codigoCita: ev.payload.codigoCita ?? null,
    consentimiento: !!ev.payload.consentimiento,
    ...(ev.payload.nombre ? { nombre: ev.payload.nombre.slice(0, 60) } : {}),
    ...(ev.payload.telefono ? { telefonoCifrado: cifrar(ev.payload.telefono) } : {}),
  };
  const tsDisp = new Date(ev.tsDispositivo);
  if (Number.isNaN(tsDisp.getTime())) return { claveIdem: ev.claveIdem, estado: "RECHAZADO", motivo: "M5_EVENTO_INVALIDO" };
  const ins = await prisma.$executeRaw`
    INSERT INTO evento_kiosco (dispositivo_id, clave_idem, seq, tipo, payload, ts_dispositivo, offset_ms_al_emitir)
    VALUES (${disp.id}::int, ${ev.claveIdem}, ${ev.seq}::int, ${ev.tipo}, ${JSON.stringify(payloadSeguro)}::jsonb, ${tsDisp}, ${ev.offsetMsAlEmitir}::int)
    ON CONFLICT (clave_idem) DO NOTHING`;
  if (Number(ins) === 0) {
    const previo = await resultadoExistente(ev.claveIdem);
    if (previo) {
      contar("m5_eventos_total", { estado: "DUPLICADO" });
      return previo;
    }
  }
  const fila = await prisma.eventoKiosco.findUniqueOrThrow({ where: { claveIdem: ev.claveIdem } });

  const previo = await prisma.eventoKiosco.findFirst({ where: { dispositivoId: disp.id, tsCorregido: { not: null }, id: { not: fila.id } }, orderBy: { tsCorregido: "desc" }, select: { tsCorregido: true } });
  const tsCorr = new Date(
    corregirTiempo({ tsDispositivoMs: tsDisp.getTime(), offsetMs: ev.offsetMsAlEmitir, ultimoHeartbeatMs: disp.ultimoHeartbeatAt?.getTime() ?? null, previoMs: previo?.tsCorregido?.getTime() ?? null, ahoraMs: ahora.getTime() }),
  );
  const marcar = async (estado: "APLICADO" | "DUPLICADO" | "REVISION" | "RECHAZADO", motivo: string | null, turnoId: number | null) => {
    await prisma.eventoKiosco.update({ where: { id: fila.id }, data: { estado, motivo, turnoId, tsCorregido: tsCorr, ...(estado === "APLICADO" || estado === "DUPLICADO" ? { payload: { colaId: payloadSeguro.colaId, categoria: payloadSeguro.categoria } as Prisma.InputJsonValue } : {}) } });
    contar("m5_eventos_total", { estado });
    if (estado === "REVISION") {
      contar("m5_revision_total", { motivo: motivo ?? "" });
      publicar({ tipo: "kiosco:evento", localId: disp.localId, dispositivoId: disp.id, estado });
    }
  };

  const motivo = validarEvento({
    fechaEventoISO: fechaLocalISO(disp.local.zonaHoraria, tsCorr),
    hoyISO: fechaLocalISO(disp.local.zonaHoraria, ahora),
    tsCorregidoMs: tsCorr.getTime(),
    ahoraMs: ahora.getTime(),
    ventanaOfflineHoras: VENTANA_OFFLINE_H,
    offsetAlEmitirMs: ev.offsetMsAlEmitir,
    offsetActualMs: disp.offsetRelojMs,
  });
  if (motivo) {
    await marcar("REVISION", motivo, null);
    return { claveIdem: ev.claveIdem, estado: "REVISION", motivo };
  }

  if (ev.tipo === "CHECKIN_CITA") {
    try {
      const { checkinPorCodigo } = await import("@backend/citas/service");
      const r = await checkinPorCodigo(disp.localId, ev.payload.codigoCita ?? "", ahora);
      const t = await prisma.turno.findUniqueOrThrow({ where: { token: r.turnoToken } });
      await marcar(r.repetido ? "DUPLICADO" : "APLICADO", null, t.id);
      return { claveIdem: ev.claveIdem, estado: r.repetido ? "DUPLICADO" : "APLICADO", turno: { codigo: t.codigo, token: t.token } };
    } catch (e) {
      const m = (e as { codigo?: string }).codigo ?? "CITA";
      await marcar("REVISION", m, null);
      return { claveIdem: ev.claveIdem, estado: "REVISION", motivo: m };
    }
  }

  const colaId = ev.payload.colaId ?? 0;
  if (disp.colaIds.length && !disp.colaIds.includes(colaId)) {
    await marcar("REVISION", "COLA_NO_ASIGNADA", null);
    return { claveIdem: ev.claveIdem, estado: "REVISION", motivo: "COLA_NO_ASIGNADA" };
  }
  try {
    const telefono = ev.payload.telefono ? normalizarTelefono(ev.payload.telefono) : null;
    const { emitirTurno } = await import("@backend/turnos");
    const t = await emitirTurno({
      colaId,
      canal: "KIOSCO",
      nombre: ev.payload.nombre ?? null,
      telefono,
      consentimiento: !!ev.payload.consentimiento,
      categoriaCodigo: ev.payload.categoria ?? null,
      origenCategoria: "CLIENTE",
      emitidoAt: tsCorr,
      dispositivoId: disp.id,
      codigoProvisional: codigoProvisional(disp.numero, ev.seq),
      // El horario se evalúa con la hora real del evento: un ticket offline emitido dentro del horario es válido
      omitirHorario: Math.abs(ahora.getTime() - tsCorr.getTime()) > 60_000,
    });
    await marcar("APLICADO", null, t.id);
    return { claveIdem: ev.claveIdem, estado: "APLICADO", turno: { codigo: t.codigo, token: t.token, posicion: t.posicion } };
  } catch (e) {
    const err = e as { codigo?: string; extra?: { token?: string } };
    if (err.codigo === "TURNO_DUPLICADO" && err.extra?.token) {
      // RN-M5-05: el cliente ya tenía turno activo ⇒ se enlaza al existente
      const t = await prisma.turno.findUnique({ where: { token: err.extra.token } });
      await marcar("DUPLICADO", "TURNO_EXISTENTE", t?.id ?? null);
      if (t) return { claveIdem: ev.claveIdem, estado: "DUPLICADO", turno: { codigo: t.codigo, token: t.token } };
    }
    const m = err.codigo ?? "ERROR";
    const enRevision = ["LIMITE_PLAN", "COLA_INACTIVA", "COLA_CERRADA", "M1_CATEGORIA_INVALIDA", "M1_CATEGORIA_NO_DISPONIBLE", "TELEFONO_INVALIDO", "CONSENTIMIENTO_REQUERIDO"].includes(m);
    if (!enRevision) log.warn("evento de kiosco no aplicado", { modulo: "M5", dispositivo: disp.id, error: e instanceof Error ? e.message : String(e) });
    await marcar("REVISION", m, null);
    return { claveIdem: ev.claveIdem, estado: "REVISION", motivo: m };
  }
}

export async function sincronizar(disp: Awaited<ReturnType<typeof autenticar>>, eventos: EventoEntrada[]) {
  if (eventos.length > 100) throw new ErrorNegocio("M5_LOTE_DEMASIADO_GRANDE", "Máximo 100 eventos por lote", 413);
  const t0 = performance.now();
  const ordenados = [...eventos].sort((a, b) => a.seq - b.seq);
  const resultados: Resultado[] = [];
  for (const ev of ordenados) resultados.push(await aplicarEvento(disp, ev));
  observar("m5_sync_lote_ms", performance.now() - t0);
  log.info("lote de kiosco", { modulo: "M5", dispositivo: disp.id, n: eventos.length, aplicados: resultados.filter((r) => r.estado === "APLICADO").length, revision: resultados.filter((r) => r.estado === "REVISION").length });
  publicar({ tipo: "cola:actualizada", localId: disp.localId });
  return { resultados, ackSeq: ordenados.length ? ordenados[ordenados.length - 1].seq : null, serverTime: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Cola de revisión (admin) y vigilancia
// ---------------------------------------------------------------------------
export async function listarEventos(localId: number, filtro: { estado?: string; dispositivoId?: number; cursor?: bigint }) {
  const items = await prisma.eventoKiosco.findMany({
    where: { dispositivo: { localId }, ...(filtro.estado ? { estado: filtro.estado as never } : {}), ...(filtro.dispositivoId ? { dispositivoId: filtro.dispositivoId } : {}), ...(filtro.cursor ? { id: { lt: filtro.cursor } } : {}) },
    orderBy: { id: "desc" },
    take: 50,
    include: { dispositivo: { select: { numero: true, nombre: true } } },
  });
  return {
    items: items.map((e) => ({ id: String(e.id), dispositivo: `K${e.dispositivo.numero} · ${e.dispositivo.nombre}`, seq: e.seq, tipo: e.tipo, estado: e.estado, motivo: e.motivo, tsDispositivo: e.tsDispositivo, tsCorregido: e.tsCorregido, recibidoAt: e.recibidoAt, turnoId: e.turnoId, colaId: (e.payload as { colaId?: number }).colaId ?? null })),
    cursor: items.length === 50 ? String(items[items.length - 1].id) : null,
  };
}

export async function resolverEvento(localId: number, id: bigint, accion: "EMITIR_AHORA" | "DESCARTAR", usuarioId: number) {
  const e = await prisma.eventoKiosco.findFirst({ where: { id, dispositivo: { localId } }, include: { dispositivo: true } });
  if (!e || e.estado !== "REVISION") throw new ErrorNegocio("M5_EVENTO_INVALIDO", "El evento no está en revisión", 409);
  if (accion === "DESCARTAR") {
    await prisma.eventoKiosco.update({ where: { id }, data: { estado: "RECHAZADO", resueltoPor: usuarioId, resueltoAt: new Date(), payload: { colaId: (e.payload as { colaId?: number }).colaId ?? null } } });
    return { estado: "RECHAZADO" };
  }
  const p = e.payload as { colaId?: number; categoria?: string | null; nombre?: string | null };
  const { emitirTurno } = await import("@backend/turnos");
  const t = await emitirTurno({ colaId: p.colaId ?? 0, canal: "KIOSCO", nombre: p.nombre ?? null, categoriaCodigo: p.categoria ?? null, origenCategoria: "PERSONAL", dispositivoId: e.dispositivoId, codigoProvisional: codigoProvisional(e.dispositivo.numero, e.seq), omitirHorario: true });
  await prisma.eventoKiosco.update({ where: { id }, data: { estado: "APLICADO", turnoId: t.id, resueltoPor: usuarioId, resueltoAt: new Date(), payload: { colaId: p.colaId ?? null } } });
  return { estado: "APLICADO", turno: { codigo: t.codigo, token: t.token } };
}

/** Job cada minuto: marca sin conexión los kioscos sin heartbeat en 75 s (M7 genera KIOSCO_OFFLINE). */
export async function jobVigilancia(ahora = new Date()) {
  const caidos = await prisma.dispositivoKiosco.findMany({ where: { enLinea: true, OR: [{ ultimoHeartbeatAt: null }, { ultimoHeartbeatAt: { lt: new Date(ahora.getTime() - 75_000) } }] } });
  for (const d of caidos) {
    await prisma.dispositivoKiosco.update({ where: { id: d.id }, data: { enLinea: false } });
    publicar({ tipo: "kiosco:estado", localId: d.localId, dispositivoId: d.id, enLinea: false });
  }
  return { sinConexion: caidos.length };
}

/** Job diario: borra eventos aplicados > 30 días y datos personales de los que quedan en revisión > 7 días. */
export async function jobLimpieza() {
  const r = await prisma.eventoKiosco.deleteMany({ where: { estado: { in: ["APLICADO", "DUPLICADO", "RECHAZADO"] }, recibidoAt: { lt: new Date(Date.now() - 30 * 86400000) } } });
  return { eliminados: r.count };
}

/** GET /public/k/:dispositivo/:fecha/:seq — resuelve el QR del ticket provisional. */
export async function resolverProvisional(dispositivoId: number, fechaISO: string, seq: number) {
  const evs = await prisma.eventoKiosco.findMany({ where: { dispositivoId, seq }, include: { dispositivo: { include: { local: true } } }, orderBy: { id: "desc" } });
  const e = evs.find((x) => fechaLocalISO(x.dispositivo.local.zonaHoraria, x.tsDispositivo) === fechaISO);
  if (!e) return { estado: "PENDIENTE" as const };
  if (e.turnoId) {
    const t = await prisma.turno.findUnique({ where: { id: e.turnoId }, select: { token: true, codigo: true } });
    if (t) return { estado: "LISTO" as const, token: t.token, codigo: t.codigo };
  }
  return { estado: e.estado === "REVISION" ? ("REVISION" as const) : ("PENDIENTE" as const) };
}

export async function verificarPinMantenimiento(dispositivoId: number, pin: string) {
  const d = await prisma.dispositivoKiosco.findUniqueOrThrow({ where: { id: dispositivoId } });
  return !!d.pinMantenimiento && d.pinMantenimiento === sha(pin);
}
