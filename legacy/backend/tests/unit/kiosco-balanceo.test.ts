import assert from "node:assert/strict";
import test from "node:test";
import { backoffMs, codigoProvisional, corregirTiempo, mejorOffset, muestraReloj, siguienteConexion, uuidv7, validarEvento } from "../../src/kiosco/reglas";
import { avanzar, condicionImposible, condicionSalida, evaluar, reglasContradictorias, sugerirMovimiento, type Condicion, type EstadoRegla, type MetricasLocal } from "../../src/balanceo/reglas";

// ------------------------------------------------------------------ M5
test("reloj: se elige la muestra de menor RTT", () => {
  const a = muestraReloj(1000, 1400, 5200); // rtt 400, offset 4000
  const b = muestraReloj(2000, 2100, 6050); // rtt 100, offset 4000
  const c = muestraReloj(3000, 3900, 9000); // rtt 900
  assert.equal(mejorOffset([a, b, c]), b.offset);
});

test("clamp: un reloj adelantado 2 h nunca deja turnos en el futuro; orden monótono", () => {
  const ahora = Date.parse("2026-10-20T15:00:00Z");
  assert.equal(corregirTiempo({ tsDispositivoMs: ahora + 7200_000, offsetMs: 0, ultimoHeartbeatMs: null, previoMs: null, ahoraMs: ahora }), ahora);
  assert.equal(corregirTiempo({ tsDispositivoMs: ahora - 60000, offsetMs: 0, ultimoHeartbeatMs: null, previoMs: ahora - 30000, ahoraMs: ahora }), ahora - 29999);
});

test("validación: fecha anterior, ventana offline y reloj inconsistente", () => {
  const base = { hoyISO: "2026-10-20", ahoraMs: Date.parse("2026-10-20T15:00:00Z"), ventanaOfflineHoras: 12, offsetAlEmitirMs: 0, offsetActualMs: 0 };
  assert.equal(validarEvento({ ...base, fechaEventoISO: "2026-10-19", tsCorregidoMs: base.ahoraMs - 3600_000 }), "FECHA_ANTERIOR");
  assert.equal(validarEvento({ ...base, fechaEventoISO: "2026-10-20", tsCorregidoMs: base.ahoraMs - 13 * 3600_000 }), "VENTANA_OFFLINE");
  assert.equal(validarEvento({ ...base, fechaEventoISO: "2026-10-20", tsCorregidoMs: base.ahoraMs, offsetActualMs: 400_000 }), "RELOJ_INCONSISTENTE");
  assert.equal(validarEvento({ ...base, fechaEventoISO: "2026-10-20", tsCorregidoMs: base.ahoraMs }), null);
});

test("backoff acotado con jitter", () => {
  assert.equal(backoffMs(0, 0), 1000);
  assert.equal(backoffMs(3, 0), 8000);
  assert.equal(backoffMs(20, 0.999), 60_999);
});

test("UUID v7 ordenable por tiempo y con versión 7", () => {
  const a = uuidv7(1000, new Uint8Array(16).fill(1));
  const b = uuidv7(2000, new Uint8Array(16).fill(1));
  assert.ok(a < b);
  assert.equal(a.split("-")[2][0], "7");
});

test("estado de conexión", () => {
  assert.equal(siguienteConexion("OFFLINE", { tipo: "OK", rtt: 100, pendientes: 3 }), "SINCRONIZANDO");
  assert.equal(siguienteConexion("ONLINE", { tipo: "FALLO", fallosSeguidos: 1, desdePrimerFalloMs: 0 }), "DEGRADADO");
  assert.equal(siguienteConexion("DEGRADADO", { tipo: "FALLO", fallosSeguidos: 3, desdePrimerFalloMs: 0 }), "OFFLINE");
  assert.equal(codigoProvisional(1, 7), "K1-0007");
});

// ------------------------------------------------------------------ M6
const m = (esperaProm: number): MetricasLocal => ({ colas: { 3: { espera_prom_min: esperaProm, ventanillas_libres: 1 }, 5: { espera_prom_min: 2, ventanillas_libres: 1 } }, local: { espera_prom_local: 5 } });
const cond: Condicion = { all: [{ metric: "espera_prom_min", scope: { cola: 3 }, op: ">", value: 20 }, { metric: "ventanillas_libres", scope: { cola: 5 }, op: ">=", value: 1 }] };

test("DSL: all/any/not", () => {
  assert.ok(evaluar(cond, m(25)));
  assert.ok(!evaluar(cond, m(10)));
  assert.ok(evaluar({ not: cond }, m(10)));
  assert.ok(evaluar({ any: [cond, { metric: "espera_prom_local", op: "<", value: 6 }] }, m(10)));
});

test("condición imposible", () => {
  assert.ok(condicionImposible({ all: [{ metric: "en_espera", op: ">", value: 20 }, { metric: "en_espera", op: "<", value: 10 }] }));
  assert.ok(!condicionImposible(cond));
});

const cfg = { forSegundos: 300, forSegundosReversa: 300, cooldownSeg: 600, ttlSeg: null, reversible: true };
const inicial: EstadoRegla = { fase: "INACTIVA", verdaderaDesdeMs: null, falsaDesdeMs: null, ultimaEjecucionMs: null, ejecutadaMs: null };

function correr(serie: boolean[], salida: boolean[], pasoMs = 30_000) {
  let e = inicial;
  const decisiones: string[] = [];
  serie.forEach((c, i) => {
    const r = avanzar(e, c, salida[i] ?? c, i * pasoMs, cfg);
    e = r.estado;
    decisiones.push(r.decision);
  });
  return { e, decisiones };
}

test("no dispara antes de forSegundos; luego ejecuta", () => {
  const { decisiones } = correr(Array(12).fill(true), Array(12).fill(true));
  assert.equal(decisiones.indexOf("EJECUTAR"), 10); // 10 × 30 s = 300 s
});

test("un parpadeo reinicia el armado (RN-M6-04)", () => {
  const serie = [...Array(8).fill(true), false, ...Array(12).fill(true)];
  const { decisiones } = correr(serie, serie);
  // Se rearma en el paso 9 y necesita 10 pasos (300 s) más
  assert.equal(decisiones.indexOf("EJECUTAR"), 19);
});

test("histéresis: no revierte hasta que la salida endurecida sea falsa 5 min", () => {
  const serie = [...Array(11).fill(true), ...Array(15).fill(false)];
  const salida = [...Array(11).fill(true), ...Array(4).fill(true), ...Array(11).fill(false)];
  const { decisiones } = correr(serie, salida);
  assert.equal(decisiones.filter((d) => d === "REVERTIR").length, 1);
  assert.ok(decisiones.indexOf("REVERTIR") >= 15 + 10);
});

test("cooldown: no vuelve a ejecutar antes de cooldownSeg", () => {
  const e: EstadoRegla = { ...inicial, fase: "ARMADA", verdaderaDesdeMs: 0, ultimaEjecucionMs: 0 };
  assert.equal(avanzar(e, true, true, 400_000, cfg).decision, "OMITIDA_COOLDOWN");
  assert.equal(avanzar(e, true, true, 700_000, cfg).decision, "EJECUTAR");
});

test("TTL revierte la acción temporal", () => {
  const e: EstadoRegla = { ...inicial, fase: "ACTIVA", ejecutadaMs: 0 };
  assert.equal(avanzar(e, true, true, 3600_000, { ...cfg, ttlSeg: 1800 }).decision, "REVERTIR");
});

test("propiedad sin oscilación: con métrica senoidal, disparos ≤ ⌈T/cooldown⌉", () => {
  const T = 4 * 3600;
  let e = inicial;
  let disparos = 0;
  for (let s = 0; s < T; s += 30) {
    const v = 20 + 5 * Math.sin(s / 400);
    const c = evaluar({ metric: "espera_prom_min", scope: { cola: 3 }, op: ">", value: 20 }, { colas: { 3: { espera_prom_min: v } }, local: { espera_prom_local: 0 } });
    const sal = evaluar(condicionSalida({ metric: "espera_prom_min", scope: { cola: 3 }, op: ">", value: 20 }, 20), { colas: { 3: { espera_prom_min: v } }, local: { espera_prom_local: 0 } });
    const r = avanzar(e, c, sal, s * 1000, cfg);
    e = r.estado;
    if (r.decision === "EJECUTAR") disparos++;
  }
  assert.ok(disparos <= Math.ceil(T / cfg.cooldownSeg), `disparos ${disparos}`);
});

test("reglas contradictorias (A↔B con cooldown corto)", () => {
  const a = { id: 1, accion: { tipo: "MOVER_OPERADOR" as const, desdeColaId: 5, haciaColaId: 3 }, forSegundos: 300, cooldownSeg: 300, activa: true };
  const b = { id: 2, accion: { tipo: "MOVER_OPERADOR" as const, desdeColaId: 3, haciaColaId: 5 }, forSegundos: 300, cooldownSeg: 300, activa: true };
  assert.equal(reglasContradictorias(b, [a]), 1);
  assert.equal(reglasContradictorias({ ...b, cooldownSeg: 900 }, [{ ...a, cooldownSeg: 900 }]), null);
});

test("sugerencia manual de balanceo", () => {
  assert.equal(sugerirMovimiento([{ colaId: 1, enEspera: 12, ventanillas: 1 }, { colaId: 2, enEspera: 1, ventanillas: 2 }])?.hacia, 1);
});
