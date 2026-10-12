import assert from "node:assert/strict";
import test from "node:test";
import { claveDe, explicarPuntaje, minutosParaAlcanzar, ordenar, secuenciaLlamadas, seleccionarSiguiente, simular, type TurnoRegla } from "../../src/lib/prioridades/reglas";
import { mulberry32 } from "../../src/lib/prediccion/cuantiles";

const cfg = { alfa: 1.5, tope: 3, aging: true };
const GEN = null;
const GEST = { codigo: "GESTANTE", pesoBase: 60, absoluta: false };
const DISC = { codigo: "DISCAPACIDAD", pesoBase: 50, absoluta: false };
const EMER = { codigo: "EMERGENCIA", pesoBase: 100, absoluta: true };
const T0 = Date.parse("2026-10-13T15:00:00Z");
const min = (m: number) => T0 - m * 60000;
const t = (id: string, esperaMin: number, categoria: TurnoRegla["categoria"]): TurnoRegla => ({ id, emitidoMs: min(esperaMin), categoria });

test("mismo peso ⇒ orden FIFO", () => {
  const o = ordenar([t("b", 2, GEN), t("a", 5, GEN), t("c", 1, GEN)], cfg);
  assert.deepEqual(o.map((x) => x.id), ["a", "b", "c"]);
});

test("Gherkin: la gestante pasa delante de un general reciente", () => {
  const o = ordenar([t("A-030", 5, GEN), t("A-031", 1, GEST)], cfg);
  assert.equal(o[0].id, "A-031");
});

test("Gherkin: un general antiguo (45 min) alcanza a una gestante recién llegada", () => {
  const o = ordenar([t("A-030", 45, GEN), t("A-031", 1, GEST)], cfg);
  assert.equal(o[0].id, "A-030");
  assert.equal(minutosParaAlcanzar(60, 1.5), 40);
});

test("la emergencia (absoluta) siempre va primero", () => {
  const o = ordenar([t("g", 200, GEN), t("p", 100, GEST), t("e", 0, EMER)], cfg);
  assert.equal(o[0].id, "e");
});

test("tope de adelantos: con tope 3 y 5 preferentes + 1 general ⇒ P,P,P,G,P,P", () => {
  const espera = [t("p1", 5, GEST), t("p2", 4, GEST), t("p3", 3, GEST), t("p4", 2, GEST), t("p5", 1, GEST), t("g", 1, GEN)];
  const sec = secuenciaLlamadas(espera, cfg).map((x) => (String(x.id).startsWith("p") ? "P" : "G"));
  assert.deepEqual(sec, ["P", "P", "P", "G", "P", "P"]);
});

test("Gherkin: tope 3 y 4 preferentes recientes ⇒ el cuarto llamado es el general", () => {
  const espera = [t("p1", 4, GEST), t("p2", 3, GEST), t("p3", 2, GEST), t("p4", 1, GEST), t("g", 1, GEN)];
  assert.equal(secuenciaLlamadas(espera, cfg)[3].id, "g");
});

test("con tope 0 no hay racha forzada", () => {
  const espera = [t("p1", 3, GEST), t("p2", 2, GEST), t("g", 1, GEN)];
  assert.equal(seleccionarSiguiente(espera, { ...cfg, tope: 0 }, 99).turno?.id, "p1");
});

test("sin aging no hay cruce aunque el general espere mucho", () => {
  const o = ordenar([t("g", 500, GEN), t("p", 0, GEST)], { ...cfg, aging: false });
  assert.equal(o[0].id, "p");
});

test("la emergencia no altera la racha", () => {
  const r = seleccionarSiguiente([t("e", 0, EMER)], cfg, 2);
  assert.equal(r.racha, 2);
});

test("explicarPuntaje coincide con el ejemplo del prototipo (≈ 82 pts)", () => {
  const e = explicarPuntaje(t("A-031", 21, DISC), cfg, T0);
  assert.equal(Math.round(e.total), 82);
  assert.match(e.texto, /50 \(base/);
});

test("simular devuelve FIFO vs priorizado del documento", () => {
  const r = simular(
    [
      { codigo: "A-030", categoria: "GENERAL", esperaMin: 38 },
      { codigo: "A-031", categoria: "DISCAPACIDAD", esperaMin: 21 },
      { codigo: "A-033", categoria: "GESTANTE", esperaMin: 9 },
    ],
    [GEST, DISC],
    cfg,
    T0,
  );
  assert.deepEqual(r.fifo, ["A-030", "A-031", "A-033"]);
  assert.deepEqual(r.priorizado, ["A-031", "A-033", "A-030"]);
  assert.equal(Math.round(r.puntajes["A-031"]), 82);
});

// --- Propiedades (generador con semilla fija) ---------------------------------
function aleatorios(semilla: number, n: number) {
  const rng = mulberry32(semilla);
  const cats = [GEN, GEST, DISC];
  return Array.from({ length: n }, (_, i) => t(`x${i}`, Math.floor(rng() * 120), cats[Math.floor(rng() * cats.length)]));
}

test("P2 (tope): nunca más de `tope` preferentes seguidos mientras haya un general esperando", () => {
  for (let s = 1; s <= 200; s++) {
    const espera = aleatorios(s, 12);
    const sec = secuenciaLlamadas(espera, cfg);
    let racha = 0;
    for (let i = 0; i < sec.length; i++) {
      const quedanGenerales = sec.slice(i).some((x) => !x.categoria);
      if (sec[i].categoria && !sec[i].categoria!.absoluta) racha++;
      else racha = 0;
      if (quedanGenerales) assert.ok(racha <= cfg.tope, `semilla ${s}`);
    }
  }
});

test("P3 (estabilidad): el orden no cambia al avanzar el reloj", () => {
  for (let s = 1; s <= 100; s++) {
    const espera = aleatorios(s, 10);
    const a = ordenar(espera, cfg).map((x) => x.id);
    const b = ordenar(espera.map((x) => ({ ...x })), cfg).map((x) => x.id);
    assert.deepEqual(a, b);
    const p1 = espera.map((x) => explicarPuntaje(x, cfg, T0).total);
    const p2 = espera.map((x) => explicarPuntaje(x, cfg, T0 + 3600_000).total);
    for (let i = 0; i < espera.length; i++) for (let j = 0; j < espera.length; j++) assert.equal(Math.sign(Math.round((p1[i] - p1[j]) * 10)), Math.sign(Math.round((p2[i] - p2[j]) * 10)));
  }
});

test("P1 (no inanición): si A esperó lo bastante más que B, A sale antes", () => {
  const A = t("A", 60, GEN);
  const B = t("B", 10, GEST);
  // A.emitido ≤ B.emitido − (pesoB − pesoA)/α ⇒ 50 min ≥ 40 min
  assert.ok(claveDe(A, cfg) > claveDe(B, cfg));
});

test("P4 (rechazo): pasar a General nunca adelanta al turno respecto de generales más recientes", () => {
  const rechazado = t("r", 10, GEN);
  const reciente = t("n", 5, GEN);
  assert.equal(ordenar([reciente, rechazado], cfg)[0].id, "r");
});
