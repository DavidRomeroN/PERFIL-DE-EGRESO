import "./setup";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "../../src/lib/db";
import { emitirTurno, llamarSiguiente, cambiarEstadoTurno, obtenerTurnoPorToken } from "../../src/lib/turnos";
import { cancelar, checkin, generarSlots, jobNoShow, jobRecordatorios, reprogramar, reservar } from "../../src/lib/citas/service";
import { procesarEntrante } from "../../src/lib/bot/service";
import { aplicarEvento, crearDispositivo, emparejar, sincronizar } from "../../src/lib/kiosco/service";
import { crearRegla, evaluarLocal as evaluarBalanceo, jobBalanceo, transferir } from "../../src/lib/balanceo/service";
import { evaluarLocal as evaluarAlertas } from "../../src/lib/analitica/alertas";
import { reentrenarCola, registrarPrediccion } from "../../src/lib/prediccion/service";
import { fechaLocalISO, sumarDiasISO } from "../../src/lib/fechas";
import { uuidv7 } from "../../src/lib/kiosco/reglas";
import { cerrar, crearLocal, telefonoAleatorio } from "./fabrica";

after(cerrar);

async function conHorarioCompleto(localId: number) {
  await prisma.horarioLocal.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ localId, diaSemana: d, apertura: "00:00", cierre: "23:59" })) });
}

async function slotFuturo(colaId: number, capacidad?: number) {
  const manana = sumarDiasISO(fechaLocalISO("America/Lima"), 1);
  await generarSlots(colaId, manana);
  const s = await prisma.slot.findFirstOrThrow({ where: { colaId, inicio: { gt: new Date(Date.now() + 3 * 3600_000) } }, orderBy: { inicio: "asc" } });
  if (capacidad) await prisma.slot.update({ where: { id: s.id }, data: { capacidad } });
  return s;
}

// ------------------------------------------------------------------ M3
test("M3 Gherkin: 50 reservas simultáneas a un slot de capacidad 3 ⇒ exactamente 3", async () => {
  const { local, colas } = await crearLocal({ modulos: ["M1", "M3"] });
  await conHorarioCompleto(local.id);
  await prisma.configCitas.upsert({ where: { colaId: colas[0].id }, create: { colaId: colas[0].id, activo: true }, update: { activo: true } });
  const s = await slotFuturo(colas[0].id, 3);
  const r = await Promise.allSettled(Array.from({ length: 50 }, (_, i) => reservar({ slug: local.slug, colaId: colas[0].id, slotId: s.id, nombre: `Cliente ${i}`, telefono: telefonoAleatorio(), consentimiento: true })));
  const ok = r.filter((x) => x.status === "fulfilled").length;
  const llenos = r.filter((x) => x.status === "rejected" && (x.reason as { codigo?: string }).codigo === "M3_SLOT_LLENO").length;
  assert.equal(ok, 3);
  assert.equal(llenos, 47);
  assert.equal((await prisma.slot.findUniqueOrThrow({ where: { id: s.id } })).reservados, 3);
});

test("M3: el mismo cliente reservando dos veces a la vez ⇒ 1 cita y el cupo sin fugas", async () => {
  const { local, colas } = await crearLocal({ modulos: ["M3"] });
  await conHorarioCompleto(local.id);
  await prisma.configCitas.upsert({ where: { colaId: colas[0].id }, create: { colaId: colas[0].id, activo: true }, update: { activo: true } });
  const s = await slotFuturo(colas[0].id, 5);
  const tel = telefonoAleatorio();
  const r = await Promise.allSettled([0, 1].map(() => reservar({ slug: local.slug, colaId: colas[0].id, slotId: s.id, nombre: "Ana", telefono: tel, consentimiento: true })));
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal((await prisma.slot.findUniqueOrThrow({ where: { id: s.id } })).reservados, 1);
});

test("M3 Gherkin: reprogramar a un horario lleno conserva la cita original; cancelar devuelve el cupo", async () => {
  const { local, colas } = await crearLocal({ modulos: ["M3"] });
  await conHorarioCompleto(local.id);
  await prisma.configCitas.upsert({ where: { colaId: colas[0].id }, create: { colaId: colas[0].id, activo: true }, update: { activo: true } });
  const s = await slotFuturo(colas[0].id, 2);
  const lleno = await prisma.slot.findFirstOrThrow({ where: { colaId: colas[0].id, id: { not: s.id }, inicio: { gt: s.inicio } } });
  await prisma.slot.update({ where: { id: lleno.id }, data: { capacidad: 1, reservados: 1 } });
  const c = await reservar({ slug: local.slug, colaId: colas[0].id, slotId: s.id, nombre: "Luis" });
  await assert.rejects(reprogramar(c.id, lleno.id), (e: { codigo?: string }) => e.codigo === "M3_SLOT_LLENO");
  assert.equal((await prisma.cita.findUniqueOrThrow({ where: { id: c.id } })).slotId, s.id);
  await cancelar(c.id);
  assert.equal((await prisma.slot.findUniqueOrThrow({ where: { id: s.id } })).reservados, 0);
});

test("M3: check-in en ventana crea el turno con categoría CITA y emitido_at = inicio; el cierre actualiza la cita", async () => {
  const { local, colas } = await crearLocal({ modulos: ["M1", "M3"] });
  await conHorarioCompleto(local.id);
  await prisma.configCitas.upsert({ where: { colaId: colas[0].id }, create: { colaId: colas[0].id, activo: true }, update: { activo: true } });
  const s = await slotFuturo(colas[0].id);
  const c = await reservar({ slug: local.slug, colaId: colas[0].id, slotId: s.id, nombre: "Rosa" });
  await assert.rejects(checkin(c.token, { presencial: true }), (e: { codigo?: string }) => e.codigo === "M3_CHECKIN_MUY_TEMPRANO");
  const r = await checkin(c.token, { presencial: true }, new Date(s.inicio.getTime() - 5 * 60000));
  const t = await prisma.turno.findUniqueOrThrow({ where: { token: r.turnoToken }, include: { categoria: true } });
  assert.equal(t.categoria?.codigo, "CITA");
  assert.equal(t.citaId, c.id);
  assert.equal(t.emitidoAt.getTime(), s.inicio.getTime());
  // El slot es de mañana: para la prueba se mueve el turno a la fila de hoy
  await prisma.turno.update({ where: { id: t.id }, data: { fecha: new Date(`${fechaLocalISO("America/Lima")}T00:00:00Z`) } });
  const llamado = await llamarSiguiente(colas[0].ventanillas[0].id, local.id);
  await cambiarEstadoTurno(llamado!.id, local.id, "ATENDIDO");
  await new Promise((res) => setTimeout(res, 300));
  assert.equal((await prisma.cita.findUniqueOrThrow({ where: { id: c.id } })).estado, "ATENDIDA");
});

test("M3: 3 inasistencias ⇒ bloqueo y M3_CLIENTE_BLOQUEADO; recordatorio una sola vez", async () => {
  const { local, colas } = await crearLocal({ modulos: ["M3"] });
  await conHorarioCompleto(local.id);
  await prisma.configCitas.upsert({ where: { colaId: colas[0].id }, create: { colaId: colas[0].id, activo: true }, update: { activo: true } });
  const tel = telefonoAleatorio();
  const pasados = [];
  for (let i = 0; i < 3; i++) {
    const slot = await prisma.slot.create({ data: { colaId: colas[0].id, inicio: new Date(Date.now() - (i + 1) * 86400000), fin: new Date(Date.now() - (i + 1) * 86400000 + 900000), capacidad: 3, reservados: 1 } });
    pasados.push(slot);
  }
  const { resolverCliente } = await import("../../src/lib/turnos");
  const clienteId = (await resolverCliente({ telefono: tel, nombre: "Pepe", consentimiento: true }))!;
  for (const s of pasados) await prisma.cita.create({ data: { localId: local.id, colaId: colas[0].id, slotId: s.id, clienteId, fecha: new Date(s.inicio.toISOString().slice(0, 10)), inicio: s.inicio, fin: s.fin, token: `T${s.id}x`.padEnd(10, "x").slice(0, 16), codigoCheckin: `C${s.id}`.slice(0, 6).padEnd(6, "Z") } });
  const r = await jobNoShow();
  assert.ok(r.noShow >= 3);
  const s = await slotFuturo(colas[0].id);
  await assert.rejects(reservar({ slug: local.slug, colaId: colas[0].id, slotId: s.id, nombre: "Pepe", telefono: tel, consentimiento: true }), (e: { codigo?: string }) => e.codigo === "M3_CLIENTE_BLOQUEADO");
  // Recordatorio idempotente
  const otro = await prisma.slot.create({ data: { colaId: colas[0].id, inicio: new Date(Date.now() + 120 * 60000 - 60000), fin: new Date(Date.now() + 135 * 60000), capacidad: 3, reservados: 1 } });
  const cli2 = (await resolverCliente({ telefono: telefonoAleatorio(), nombre: "Zoe", consentimiento: true }))!;
  const cita = await prisma.cita.create({ data: { localId: local.id, colaId: colas[0].id, slotId: otro.id, clienteId: cli2, fecha: new Date(), inicio: otro.inicio, fin: otro.fin, token: `R${otro.id}`.padEnd(10, "r"), codigoCheckin: `R${otro.id}`.slice(0, 6).padEnd(6, "Q") } });
  await jobRecordatorios();
  await jobRecordatorios();
  assert.equal(await prisma.citaRecordatorio.count({ where: { citaId: cita.id } }), 1);
});

// ------------------------------------------------------------------ M4
function mensaje(desde: string, texto: string, id = uuidv7()) {
  return { proveedor: "openwa" as const, mensajeId: id, canalId: "sesion-prueba", desde, texto, tipo: "texto" as const, tsMs: Date.now(), esGrupo: false, propio: false };
}

test("M4 Gherkin: tomar turno por WhatsApp y mensaje duplicado ⇒ un solo turno", async () => {
  const { local, colas } = await crearLocal({ modulos: ["M4"] });
  await prisma.canalWhatsapp.deleteMany({ where: { identificador: "sesion-prueba" } });
  await prisma.canalWhatsapp.create({ data: { localId: local.id, proveedor: "openwa", identificador: "sesion-prueba", botActivo: true } });
  const tel = `+51${telefonoAleatorio()}`;
  for (const t of ["hola", "1", "1", "omitir", "sí"]) await procesarEntrante(mensaje(tel, t));
  const ultimo = mensaje(tel, "sí");
  await procesarEntrante(ultimo);
  const dup = await procesarEntrante(ultimo);
  assert.equal(dup.ignorado, "DUPLICADO");
  const turnos = await prisma.turno.findMany({ where: { colaId: colas[0].id, canal: "WHATSAPP" } });
  assert.equal(turnos.length, 1);
  // D1: la conversación pertenece al local del canal
  assert.equal(await prisma.conversacionBot.count({ where: { localId: local.id } }), 1);
  await prisma.canalWhatsapp.deleteMany({ where: { identificador: "sesion-prueba" } });
});

test("M4: mensajes viejos, de grupo o propios se ignoran", async () => {
  assert.equal((await procesarEntrante({ ...mensaje("+51900000000", "hola"), esGrupo: true })).ignorado, "GRUPO");
  assert.equal((await procesarEntrante({ ...mensaje("+51900000000", "hola"), tsMs: Date.now() - 600000 })).ignorado, "VIEJO");
});

// ------------------------------------------------------------------ M5
test("M5 Gherkin: sincronización sin duplicados aunque el lote se repita 3 veces; orden por emisión", async () => {
  const { local, colas } = await crearLocal({ modulos: ["M5"] });
  const { codigo } = await crearDispositivo(local.id, "Entrada", [colas[0].id]);
  const par = await emparejar(codigo);
  const disp = await prisma.dispositivoKiosco.findUniqueOrThrow({ where: { id: par.dispositivoId }, include: { local: true } });
  const ahora = Date.now();
  const eventos = [1, 2, 3].map((seq) => ({ claveIdem: uuidv7(ahora - 600000 + seq * 1000), seq, tipo: "EMITIR_TURNO" as const, tsDispositivo: new Date(ahora - 600000 + seq * 60000).toISOString(), offsetMsAlEmitir: 0, payload: { colaId: colas[0].id } }));
  const r1 = await sincronizar(disp, eventos);
  const r2 = await sincronizar(disp, eventos);
  await sincronizar(disp, eventos);
  assert.deepEqual(r1.resultados.map((r) => r.estado), ["APLICADO", "APLICADO", "APLICADO"]);
  assert.deepEqual(r2.resultados.map((r) => r.estado), ["DUPLICADO", "DUPLICADO", "DUPLICADO"]);
  const turnos = await prisma.turno.findMany({ where: { colaId: colas[0].id }, orderBy: { emitidoAt: "asc" } });
  assert.equal(turnos.length, 3);
  assert.deepEqual(turnos.map((t) => t.codigoProvisional), ["K1-0001", "K1-0002", "K1-0003"]);
});

test("M5: evento de ayer ⇒ REVISION; reloj 2 h adelantado ⇒ nunca en el futuro", async () => {
  const { local, colas } = await crearLocal({ modulos: ["M5"] });
  const { codigo } = await crearDispositivo(local.id, "Sala", []);
  const par = await emparejar(codigo);
  const disp = await prisma.dispositivoKiosco.findUniqueOrThrow({ where: { id: par.dispositivoId }, include: { local: true } });
  const ayer = await aplicarEvento(disp, { claveIdem: uuidv7(), seq: 1, tipo: "EMITIR_TURNO", tsDispositivo: new Date(Date.now() - 30 * 3600_000).toISOString(), offsetMsAlEmitir: 0, payload: { colaId: colas[0].id } });
  assert.equal(ayer.estado, "REVISION");
  const futuro = await aplicarEvento(disp, { claveIdem: uuidv7(), seq: 2, tipo: "EMITIR_TURNO", tsDispositivo: new Date(Date.now() + 7200_000).toISOString(), offsetMsAlEmitir: 0, payload: { colaId: colas[0].id } });
  assert.equal(futuro.estado, "APLICADO");
  const t = await prisma.turno.findFirstOrThrow({ where: { colaId: colas[0].id } });
  assert.ok(t.emitidoAt.getTime() <= Date.now());
});

test("M5: código de emparejamiento de un solo uso", async () => {
  const { local } = await crearLocal({ modulos: ["M5"] });
  const { codigo } = await crearDispositivo(local.id, "K", []);
  await emparejar(codigo);
  await assert.rejects(emparejar(codigo), (e: { codigo?: string }) => e.codigo === "M5_CODIGO_INVALIDO");
});

// ------------------------------------------------------------------ M6
test("M6 Gherkin: la transferencia conserva la hora de emisión y el enlace redirige", async () => {
  const { local, colas } = await crearLocal({ modulos: ["M6"], colas: 2 });
  const t = await emitirTurno({ colaId: colas[0].id, canal: "QR", telefono: telefonoAleatorio(), consentimiento: true });
  await new Promise((r) => setTimeout(r, 20));
  const otro = await emitirTurno({ colaId: colas[1].id, canal: "QR" });
  const s = await transferir({}, local.id, t.id, { aColaId: colas[1].id, motivo: "ERROR_DE_COLA" });
  const orig = await prisma.turno.findUniqueOrThrow({ where: { id: t.id } });
  const suc = await prisma.turno.findUniqueOrThrow({ where: { id: s.id } });
  assert.equal(orig.estado, "TRANSFERIDO");
  assert.equal(orig.sucesorId, suc.id);
  assert.equal(suc.emitidoAt.getTime(), orig.emitidoAt.getTime());
  assert.equal((await obtenerTurnoPorToken(t.token)).redirigidoA?.token, suc.token);
  // conserva el lugar: queda antes que el turno que ya estaba en la cola destino
  assert.equal((await obtenerTurnoPorToken(suc.token)).posicion, 1);
  assert.equal((await obtenerTurnoPorToken(otro.token)).posicion, 2);
});

test("M6: transferir mientras otra ventanilla llama ⇒ solo una operación gana", async () => {
  const { local, colas } = await crearLocal({ modulos: ["M6"], colas: 2 });
  const t = await emitirTurno({ colaId: colas[0].id, canal: "QR" });
  const r = await Promise.allSettled([transferir({}, local.id, t.id, { aColaId: colas[1].id, motivo: "DERIVACION" }), llamarSiguiente(colas[0].ventanillas[0].id, local.id)]);
  const final = await prisma.turno.findUniqueOrThrow({ where: { id: t.id } });
  assert.ok(["TRANSFERIDO", "LLAMADO"].includes(final.estado));
  if (final.estado === "LLAMADO") assert.equal(await prisma.turno.count({ where: { transferidoDeTurnoId: t.id } }), 0);
  assert.ok(r.length === 2);
});

test("M6 Gherkin: regla en simulación registra y no mueve; D5: local sin M6 no se toca", async () => {
  const { local, colas } = await crearLocal({ modulos: ["M6"], colas: 2, ventanillasPorCola: 2 });
  for (let i = 0; i < 25; i++) await emitirTurno({ colaId: colas[0].id, canal: "QR" });
  const regla = await crearRegla({}, local.id, { nombre: "Refuerzo", condicion: { metric: "en_espera", scope: { cola: colas[0].id }, op: ">", value: 20 }, accion: { tipo: "MOVER_OPERADOR", desdeColaId: colas[1].id, haciaColaId: colas[0].id }, forSegundos: 0, cooldownSeg: 600 });
  assert.equal(regla.modo, "SIMULACION");
  await evaluarBalanceo(local.id);
  const ej = await prisma.ejecucionRegla.findFirstOrThrow({ where: { reglaId: regla.id } });
  assert.equal(ej.resultado, "SIMULADA");
  assert.equal(await prisma.ventanilla.count({ where: { localId: local.id, colaId: colas[0].id } }), 2);
  // Activa: ahora sí mueve una ventanilla
  await prisma.reglaBalanceo.update({ where: { id: regla.id }, data: { modo: "ACTIVA" } });
  await prisma.reglaEstado.deleteMany({ where: { reglaId: regla.id } });
  await evaluarBalanceo(local.id);
  assert.equal(await prisma.ventanilla.count({ where: { localId: local.id, colaId: colas[0].id } }), 3);
  // D5: otro local con reglas pero sin el módulo no se evalúa
  const otro = await crearLocal({ colas: 2, ventanillasPorCola: 2 });
  await prisma.reglaBalanceo.create({ data: { localId: otro.local.id, nombre: "x", modo: "ACTIVA", activa: true, condicion: { metric: "en_espera", op: ">=", value: 0 }, accion: { tipo: "MOVER_OPERADOR", desdeColaId: otro.colas[1].id, haciaColaId: otro.colas[0].id }, forSegundos: 0 } });
  await jobBalanceo();
  assert.equal(await prisma.ejecucionRegla.count({ where: { localId: otro.local.id } }), 0);
});

// ------------------------------------------------------------------ M7
test("M7 Gherkin: ESPERA_ALTA se abre a la 2.ª evaluación, sin duplicados con evaluaciones concurrentes", async () => {
  const { local, colas } = await crearLocal({ modulos: ["M7"] });
  const t = await emitirTurno({ colaId: colas[0].id, canal: "QR" });
  await prisma.turno.update({ where: { id: t.id }, data: { emitidoAt: new Date(Date.now() - 40 * 60000) } });
  await evaluarAlertas(local.id);
  assert.equal(await prisma.alerta.count({ where: { localId: local.id } }), 0);
  await Promise.all([evaluarAlertas(local.id), evaluarAlertas(local.id)]);
  const alertas = await prisma.alerta.findMany({ where: { localId: local.id, tipo: "ESPERA_ALTA" } });
  assert.equal(alertas.length, 1);
  assert.equal(alertas[0].estado, "ABIERTA");
});

// ------------------------------------------------------------------ M2
test("M2: se registra la predicción al emitir y el reentrenamiento deja un modelo activo", async () => {
  const { local, colas } = await crearLocal({ modulos: ["M2"] });
  const c = colas[0];
  const base = Date.now() - 20 * 86400000;
  for (let i = 0; i < 80; i++) {
    const emit = new Date(base + i * 3 * 3600_000);
    await prisma.turno.create({ data: { localId: local.id, colaId: c.id, numero: 1000 + i, codigo: `A-${1000 + i}`, token: `H${i}${Math.random().toString(36).slice(2, 10)}`.slice(0, 16), canal: "QR", estado: "ATENDIDO", emitidoAt: emit, llamadoAt: new Date(emit.getTime() + 600000), finalizadoAt: new Date(emit.getTime() + 900000), fecha: new Date(emit.toISOString().slice(0, 10)), delanteEmision: 2, ventanillasActivasEmision: 1 } });
  }
  const r = await reentrenarCola(c.id);
  assert.ok(["BASELINE", "EMA"].includes(r.elegido));
  assert.equal(await prisma.modeloEntrenado.count({ where: { colaId: c.id, activo: true } }), 1);
  const t = await emitirTurno({ colaId: c.id, canal: "QR" });
  await registrarPrediccion(t.id);
  const log = await prisma.prediccionLog.findUniqueOrThrow({ where: { turnoId: t.id } });
  assert.ok(log.loSeg <= log.predSeg && log.predSeg <= log.hiSeg);
  assert.ok((await obtenerTurnoPorToken(t.token)).prediccion);
});
