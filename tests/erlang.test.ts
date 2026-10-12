import assert from "node:assert/strict";
import test from "node:test";
import { erlangC } from "../src/lib/capacidad/erlang";
import { simularCola } from "../src/lib/capacidad/des";
import { cuantil } from "../src/lib/prediccion/cuantiles";
import { sugerirMovimiento } from "../src/lib/balanceo/reglas";
import { cumplimientoSla } from "../src/lib/analitica/sla";
import { transicion } from "../src/lib/bot/fsm";
import { ajustarModelos } from "../src/lib/prediccion/modelos";

test("erlang C con un servidor y carga media", () => {
  const r = erlangC(30, 5, 1);
  assert.equal(r.estable, false);
});

test("erlang C estable con holgura", () => {
  const r = erlangC(30, 5, 4);
  assert.equal(r.estable, true);
  assert.ok((r.esperaMin ?? 99) < 15);
});

test("la simulación es reproducible", () => {
  const a = simularCola({ llegadasPorHora: 20, servicioMin: 4, servidores: 2, horas: 2, replicas: 3, semilla: 3 });
  const b = simularCola({ llegadasPorHora: 20, servicioMin: 4, servidores: 2, horas: 2, replicas: 3, semilla: 3 });
  assert.equal(a.atendidos, b.atendidos);
  assert.ok(a.atendidos > 0);
});

test("cuantil de la mediana", () => {
  assert.equal(cuantil([1, 2, 3, 4], 0.5), 2.5);
});

test("sugiere mover una ventanilla", () => {
  const m = sugerirMovimiento([{ colaId: 1, enEspera: 12, ventanillas: 1 }, { colaId: 2, enEspera: 1, ventanillas: 2 }]);
  assert.equal(m?.hacia, 1);
});

test("el SLA ignora a quien sigue esperando", () => {
  const r = cumplimientoSla([{ esperaMin: 4, cerrado: true }, { esperaMin: 20, cerrado: true }, { esperaMin: null, cerrado: false }], 10);
  assert.equal(r.cumplimiento, 0.5);
});

test("elige un modelo con menor error", () => {
  const muestras = Array.from({ length: 12 }, (_, i) => ({ hora: 9, esperaMin: 5 + (i % 2) }));
  const mejor = ajustarModelos(muestras);
  assert.ok(["BASELINE", "EMA", "ESTACIONAL"].includes(mejor.nombre));
  assert.ok(mejor.predecir(9) > 0);
});

test("el bot ofrece el menú", () => {
  const r = transicion({ estado: "INICIO" }, "hola", [{ id: 1, nombre: "Caja" }]);
  assert.match(r.respuesta, /Tomar turno/);
});
