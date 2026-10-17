import assert from "node:assert/strict";
import test from "node:test";
import { cuantil, mulberry32, winsorizar } from "../../src/prediccion/cuantiles";
import { actualizarServicio, elegibles, elegirModelo, entrenar, estadoInicial, hayDeriva, intervalo, predecir, replay, servicioCelda, type MuestraTurno } from "../../src/prediccion/modelos";

test("cuantiles tipo 7 contra valores de referencia", () => {
  assert.equal(cuantil([1, 2, 3, 4, 5], 0.1), 1.4);
  assert.equal(cuantil([1, 2, 3, 4, 5], 0.9), 4.6);
  assert.equal(cuantil([1, 2, 3, 4], 0.5), 2.5);
});

test("winsorización al p99", () => {
  const xs = [...Array(99).fill(10), 10000];
  assert.ok(Math.max(...winsorizar(xs)) < 10000);
});

test("EMA exacta contra la recurrencia manual", () => {
  const e = estadoInicial("EMA", 300, 0.2);
  actualizarServicio(e, 200, 1, 20);
  actualizarServicio(e, 400, 1, 20);
  assert.equal(e.sbar, 0.2 * 400 + 0.8 * 200);
  assert.equal(predecir(e, 2, 1, 1, 20), 3 * e.sbar);
});

test("contracción: sin datos en la celda usa la mediana de la cola", () => {
  const e = estadoInicial("ESTACIONAL", 300);
  for (let i = 0; i < 20; i++) actualizarServicio(e, 100, 2, 20);
  assert.equal(servicioCelda(e, 5, 30), 100);
});

test("c = 0 se trata como 1 y k = 0 predice un servicio", () => {
  const e = estadoInicial("EMA", 300);
  assert.equal(predecir(e, 0, 0, 1, 10), 300);
});

test("monotonía: más personas delante ⇒ más espera; más ventanillas ⇒ menos", () => {
  const e = estadoInicial("EMA", 300);
  assert.ok(predecir(e, 5, 2, 1, 10) >= predecir(e, 4, 2, 1, 10));
  assert.ok(predecir(e, 5, 3, 1, 10) <= predecir(e, 5, 2, 1, 10));
});

test("intervalo: lo ≤ pred ≤ hi (también en frío)", () => {
  const e = estadoInicial("BASELINE", 300);
  const r = intervalo(e, 600, 20);
  assert.ok(r.lo <= 600 && 600 <= r.hi);
});

test("arranque en frío y elegibilidad (RN-M2-02)", () => {
  assert.deepEqual(elegibles(20, 30), ["BASELINE"]);
  assert.deepEqual(elegibles(100, 30), ["BASELINE", "EMA"]);
  assert.deepEqual(elegibles(500, 30), ["BASELINE", "EMA", "ESTACIONAL"]);
});

test("histéresis AUTO del 5 % (RN-M2-06)", () => {
  assert.equal(elegirModelo({ BASELINE: 100, EMA: 97 }, "BASELINE", ["BASELINE", "EMA"]), "BASELINE");
  assert.equal(elegirModelo({ BASELINE: 100, EMA: 90 }, "BASELINE", ["BASELINE", "EMA"]), "EMA");
});

test("deriva: MAE de producción > 1.3 × validación", () => {
  assert.equal(hayDeriva(180, 120, 50), true);
  assert.equal(hayDeriva(150, 120, 50), false);
});

/** Generador sintético: una ventanilla FIFO, llegadas Poisson y servicio log-normal con media por franja conocida. */
function sintetico(dias: number, semilla: number): MuestraTurno[] {
  const rng = mulberry32(semilla);
  const out: MuestraTurno[] = [];
  let id = 1;
  const base = Date.parse("2026-08-01T13:00:00Z");
  for (let d = 0; d < dias; d++) {
    let t = base + d * 86400000;
    let libre = t;
    const fin = t + 8 * 3600_000;
    const enCola: number[] = [];
    while (t < fin) {
      t += -Math.log(1 - rng()) * 6 * 60000;
      const franja = 16 + Math.floor((t - (base + d * 86400000)) / 1800000);
      const mediaSrv = franja < 22 ? 4 : 7; // la tarde es más lenta
      const srv = Math.exp(Math.log(mediaSrv * 60) + 0.3 * (rng() - 0.5)) * 1000;
      const delante = enCola.filter((x) => x > t).length;
      const inicio = Math.max(t, libre);
      libre = inicio + srv;
      enCola.push(inicio);
      out.push({ id: id++, emitidoMs: t, llamadoMs: inicio, finalizadoMs: libre, atendido: true, delante, c: 1, dow: (d + 6) % 7, franja });
    }
  }
  return out;
}

test("sin fuga de datos: alterar el futuro no cambia predicciones pasadas", () => {
  const m = sintetico(10, 7);
  const corte = m[Math.floor(m.length / 2)].emitidoMs;
  const a = replay(m, estadoInicial("ESTACIONAL", 300)).pares.filter((p) => p.tMs < corte - 3600_000);
  const alterado = m.map((x) => (x.emitidoMs >= corte ? { ...x, finalizadoMs: (x.finalizadoMs ?? 0) + 3600_000 } : x));
  const b = replay(alterado, estadoInicial("ESTACIONAL", 300)).pares.filter((p) => p.tMs < corte - 3600_000);
  assert.deepEqual(a.map((p) => p.pred), b.map((p) => p.pred));
});

test("con datos sintéticos estacionales, ESTACIONAL ≤ EMA ≤ BASELINE en MAE y la cobertura es razonable", () => {
  const m = sintetico(40, 11);
  const ahoraMs = m[m.length - 1].emitidoMs + 3600_000;
  const r = (tipo: "BASELINE" | "EMA" | "ESTACIONAL") => entrenar(tipo, m, { base: 300, alfa: 0.2, nivel: 0.8, ahoraMs }).metricas;
  const base = r("BASELINE");
  const ema = r("EMA");
  const est = r("ESTACIONAL");
  assert.ok(ema.mae <= base.mae * 1.05, `EMA ${ema.mae} vs BASELINE ${base.mae}`);
  assert.ok(est.mae <= ema.mae * 1.05, `ESTACIONAL ${est.mae} vs EMA ${ema.mae}`);
  assert.ok(est.cobertura > 0.6 && est.cobertura <= 1, `cobertura ${est.cobertura}`);
});
