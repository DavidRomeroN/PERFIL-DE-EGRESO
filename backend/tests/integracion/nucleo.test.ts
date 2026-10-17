import "./setup";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { prisma } from "../../src/db";
import { cambiarEstadoTurno, cancelarTurno, emitirTurno, llamarSiguiente, obtenerTurnoPorToken, snapshotLocal } from "../../src/turnos";
import { cambiarPrioridadTurno, guardarConfig, recalcularClaves } from "../../src/prioridades/service";
import { cambiarModulo, exigirModulo } from "../../src/modulos";
import { cerrar, crearLocal, telefonoAleatorio } from "./fabrica";

after(cerrar);

test("caracterización del núcleo sin módulos: FIFO, posición, cancelar, llamar, rellamar", async () => {
  const { local, colas } = await crearLocal();
  const c = colas[0];
  const a = await emitirTurno({ colaId: c.id, canal: "QR", nombre: "Ana" });
  const b = await emitirTurno({ colaId: c.id, canal: "QR", nombre: "Beto" });
  const d = await emitirTurno({ colaId: c.id, canal: "TICKET" });
  assert.deepEqual([a.codigo, b.codigo, d.codigo], ["A-001", "A-002", "A-003"]);
  assert.equal((await obtenerTurnoPorToken(d.token)).posicion, 3);
  await cancelarTurno(b.token);
  assert.equal((await obtenerTurnoPorToken(d.token)).posicion, 2);
  const llamado = await llamarSiguiente(c.ventanillas[0].id, local.id);
  assert.equal(llamado?.codigo, "A-001");
  await cambiarEstadoTurno(llamado!.id, local.id, "LLAMADO");
  const t = await prisma.turno.findUniqueOrThrow({ where: { id: llamado!.id } });
  assert.equal(t.rellamadas, 1);
  // El siguiente llamado cierra el anterior como ATENDIDO
  const sig = await llamarSiguiente(c.ventanillas[0].id, local.id);
  assert.equal(sig?.codigo, "A-003");
  assert.equal((await prisma.turno.findUniqueOrThrow({ where: { id: llamado!.id } })).estado, "ATENDIDO");
  await assert.rejects(cambiarEstadoTurno(llamado!.id, local.id, "LLAMADO"), /Transición/);
});

test("F0: 50 emisiones concurrentes sin números duplicados", async () => {
  const { colas } = await crearLocal();
  const r = await Promise.all(Array.from({ length: 50 }, () => emitirTurno({ colaId: colas[0].id, canal: "QR" })));
  assert.equal(new Set(r.map((x) => x.numero)).size, 50);
});

test("RN03: un celular no puede tener dos turnos activos en la misma cola", async () => {
  const { colas } = await crearLocal();
  const tel = telefonoAleatorio();
  await emitirTurno({ colaId: colas[0].id, canal: "QR", telefono: tel, consentimiento: true });
  await assert.rejects(emitirTurno({ colaId: colas[0].id, canal: "QR", telefono: tel, consentimiento: true }), (e: { codigo?: string }) => e.codigo === "TURNO_DUPLICADO");
});

test("C1 (regresión): un cliente no puede declararse EMERGENCIA", async () => {
  const { colas } = await crearLocal({ modulos: ["M1"] });
  await assert.rejects(emitirTurno({ colaId: colas[0].id, canal: "QR", categoriaCodigo: "EMERGENCIA" }), (e: { codigo?: string }) => e.codigo === "M1_CATEGORIA_NO_DISPONIBLE");
  await assert.rejects(emitirTurno({ colaId: colas[0].id, canal: "QR", categoriaCodigo: "CITA" }), (e: { codigo?: string }) => e.codigo === "M1_CATEGORIA_NO_DISPONIBLE");
  const t = await emitirTurno({ colaId: colas[0].id, canal: "TICKET", categoriaCodigo: "EMERGENCIA", origenCategoria: "PERSONAL" });
  assert.ok(t.id);
});

test("M1 en la BD: el adulto mayor pasa delante y el tope de adelantos corta la racha", async () => {
  const { local, colas } = await crearLocal({ modulos: ["M1"] });
  const c = colas[0];
  const g = await emitirTurno({ colaId: c.id, canal: "QR" });
  const ps = [];
  for (let i = 0; i < 4; i++) ps.push(await emitirTurno({ colaId: c.id, canal: "QR", categoriaCodigo: "ADULTO_MAYOR" }));
  assert.equal((await obtenerTurnoPorToken(ps[0].token)).posicion, 1);
  const orden = [];
  for (let i = 0; i < 5; i++) orden.push((await llamarSiguiente(c.ventanillas[0].id, local.id))!.codigo);
  // tope 3: P, P, P, G, P
  assert.equal(orden[3], g.codigo);
});

test("C2 (regresión): 3 ventanillas llamando a la vez nunca toman el mismo turno", async () => {
  const { local, colas } = await crearLocal({ modulos: ["M1"], ventanillasPorCola: 3 });
  const c = colas[0];
  for (let i = 0; i < 45; i++) await emitirTurno({ colaId: c.id, canal: "QR", categoriaCodigo: i % 3 === 0 ? "GESTANTE" : null });
  const llamados: number[] = [];
  for (let ronda = 0; ronda < 15; ronda++) {
    const r = await Promise.all(c.ventanillas.map((v) => llamarSiguiente(v.id, local.id)));
    for (const t of r) if (t) llamados.push(t.id);
  }
  assert.equal(llamados.length, 45);
  assert.equal(new Set(llamados).size, 45);
});

test("C4 (regresión): cambiar pesos/α recalcula las claves de los turnos en espera", async () => {
  const { local, colas } = await crearLocal({ modulos: ["M1"] });
  const g = await emitirTurno({ colaId: colas[0].id, canal: "QR" });
  const p = await emitirTurno({ colaId: colas[0].id, canal: "QR", categoriaCodigo: "GESTANTE" });
  assert.equal((await obtenerTurnoPorToken(p.token)).posicion, 1);
  await prisma.categoriaPrioridad.updateMany({ where: { localId: local.id, codigo: "GESTANTE" }, data: { pesoBase: 0 } });
  const n = await recalcularClaves(local.id);
  assert.ok(n >= 2);
  assert.equal((await obtenerTurnoPorToken(g.token)).posicion, 1);
  const r = await guardarConfig({}, local.id, { alfa: 2, tope: 3, aging: true });
  assert.ok(r.recalculados >= 2);
});

test("RN-M1-04: rechazar la prioridad conserva la hora de emisión y deja auditoría", async () => {
  const { local, colas } = await crearLocal({ modulos: ["M1"] });
  const p = await emitirTurno({ colaId: colas[0].id, canal: "QR", categoriaCodigo: "ADULTO_MAYOR" });
  const antes = await prisma.turno.findUniqueOrThrow({ where: { id: p.id } });
  await cambiarPrioridadTurno({ requestId: "req-test" }, local.id, p.id, "RECHAZAR");
  const despues = await prisma.turno.findUniqueOrThrow({ where: { id: p.id } });
  assert.equal(despues.emitidoAt.getTime(), antes.emitidoAt.getTime());
  assert.equal(despues.categoriaId, null);
  assert.equal(despues.prioridadVerificada, false);
  assert.ok(await prisma.auditoria.findFirst({ where: { localId: local.id, accion: "PRIORIDAD_RECHAZAR", requestId: "req-test" } }));
});

test("privacidad (RN-M1-06): el snapshot público no expone la categoría", async () => {
  const { local, colas } = await crearLocal({ modulos: ["M1"] });
  await emitirTurno({ colaId: colas[0].id, canal: "QR", categoriaCodigo: "GESTANTE", nombre: "María" });
  const publico = JSON.stringify(await snapshotLocal(local.slug, { incluirNombres: false }));
  assert.ok(!/GESTANTE|Gestante|María/.test(publico));
  const panel = JSON.stringify(await snapshotLocal(local.slug, { incluirNombres: true }));
  assert.ok(/Gestante/.test(panel));
});

test("posicion_turno coincide con el orden de llamada para 60 turnos aleatorios", async () => {
  const { local, colas } = await crearLocal({ modulos: ["M1"] });
  const cats = [null, "ADULTO_MAYOR", "GESTANTE", "DISCAPACIDAD"];
  const ts = [];
  for (let i = 0; i < 60; i++) ts.push(await emitirTurno({ colaId: colas[0].id, canal: "QR", categoriaCodigo: cats[i % 4] }));
  await guardarConfig({}, local.id, { alfa: 1.5, tope: 0, aging: true });
  const pos = await Promise.all(ts.map(async (t) => ({ id: t.id, p: (await obtenerTurnoPorToken(t.token)).posicion })));
  pos.sort((a, b) => a.p - b.p);
  assert.deepEqual(pos.map((x) => x.p), Array.from({ length: 60 }, (_, i) => i + 1));
  const primero = await llamarSiguiente(colas[0].ventanillas[0].id, local.id);
  assert.equal(primero?.id, pos[0].id);
});

test("F3: un módulo apagado responde MODULO_NO_DISPONIBLE y el plan lo limita", async () => {
  const { local } = await crearLocal();
  await assert.rejects(exigirModulo(local.id, "M5"), (e: { codigo?: string; status?: number }) => e.codigo === "MODULO_NO_DISPONIBLE" && e.status === 403);
  await cambiarModulo(local.id, "M5", true);
  await exigirModulo(local.id, "M5");
  const gratis = await prisma.plan.upsert({ where: { codigo: "GRATIS_TEST" }, create: { codigo: "GRATIS_TEST", nombre: "Gratis", precioMensual: 0, maxTurnosMes: 2, maxColas: 1, maxVentanillas: 1, whatsappHabilitado: false, maxAvisosWhatsapp: 0 }, update: {} });
  await prisma.local.update({ where: { id: local.id }, data: { planId: gratis.id } });
  await assert.rejects(cambiarModulo(local.id, "M1", true), (e: { codigo?: string }) => e.codigo === "MODULO_NO_INCLUIDO");
});

test("RN05: límite mensual del plan", async () => {
  const { local, colas } = await crearLocal();
  const chico = await prisma.plan.upsert({ where: { codigo: "MINI_TEST" }, create: { codigo: "MINI_TEST", nombre: "Mini", precioMensual: 0, maxTurnosMes: 2, maxColas: 1, maxVentanillas: 1, whatsappHabilitado: false, maxAvisosWhatsapp: 0 }, update: {} });
  await prisma.local.update({ where: { id: local.id }, data: { planId: chico.id } });
  await emitirTurno({ colaId: colas[0].id, canal: "QR" });
  await emitirTurno({ colaId: colas[0].id, canal: "QR" });
  await assert.rejects(emitirTurno({ colaId: colas[0].id, canal: "QR" }), (e: { codigo?: string }) => e.codigo === "LIMITE_PLAN");
});
