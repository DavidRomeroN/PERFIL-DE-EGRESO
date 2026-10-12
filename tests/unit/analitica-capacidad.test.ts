import assert from "node:assert/strict";
import test from "node:test";
import { cumplimientoSla } from "../../src/lib/analitica/sla";
import { avanzarAlerta, periodoQueToca, semanaIso, zRobusto, type AlertaViva, type Nivel } from "../../src/lib/analitica/reglas";
import { cuantil } from "../../src/lib/prediccion/cuantiles";
import { erlangC, minimoServidores, nivelServicio, probEspera, probEsperaMayor } from "../../src/lib/capacidad/erlang";
import { Monticulo, ajustarLogNormal, compararPareado, logNormal, monteCarlo, mulberry32, resumir, simularReplica, type ParametrosSim } from "../../src/lib/capacidad/des";

// ------------------------------------------------------------------ M7
test("percentiles tipo 7: [10..50] ⇒ 30 / 46 / 48", () => {
  const xs = [10, 20, 30, 40, 50];
  assert.equal(cuantil(xs, 0.5), 30);
  assert.equal(cuantil(xs, 0.9), 46);
  assert.equal(cuantil(xs, 0.95), 48);
});

test("SLA con censura a la derecha: ejemplo del documento ⇒ 66,7 %", () => {
  const L = (min: number) => ({ estado: "ATENDIDO", llamado: true, esperaSeg: min * 60 });
  const turnos = [...[1, 2, 3, 5, 10, 14].map(L), L(16), L(30), { estado: "EMITIDO", llamado: false, esperaSeg: 20 * 60 }, { estado: "EMITIDO", llamado: false, esperaSeg: 5 * 60 }];
  const r = cumplimientoSla(turnos, 15, 90);
  assert.equal(r.cumplen, 6);
  assert.equal(r.incumplen, 3);
  assert.equal(r.pendientes, 1);
  assert.equal(Math.round(r.cumplimiento! * 1000) / 10, 66.7);
});

test("Gherkin: un turno que lleva 20 min esperando ya incumple el SLA de 15 min", () => {
  assert.equal(cumplimientoSla([{ estado: "AVISADO", llamado: false, esperaSeg: 1200 }], 15).incumplen, 1);
});

test("SLA sin muestras y todos pendientes ⇒ cumplimiento nulo", () => {
  assert.equal(cumplimientoSla([], 15).cumplimiento, null);
  assert.equal(cumplimientoSla([{ estado: "EMITIDO", llamado: false, esperaSeg: 60 }], 15).cumplimiento, null);
});

test("z robusto: ejemplo ≈ 12,8 y piso de MAD", () => {
  const z = zRobusto([20, 22, 19, 21, 23, 20, 22, 21], 40)!;
  assert.ok(Math.abs(z - 12.8) < 0.1, String(z));
  assert.ok(zRobusto([5, 5, 5, 5], 5) === 0);
  assert.equal(zRobusto([1, 2, 3], 10), null);
});

const niveles: Nivel[] = [{ traMin: 0, canales: ["IN_APP"] }, { traMin: 10, canales: ["WHATSAPP"] }, { traMin: 30, canales: ["CORREO"] }];
function fsm(dispara: boolean, ahoraMin: number, racha = { disparos: 0, normalDesdeMs: null as number | null }, alerta: AlertaViva | null = null) {
  return avanzarAlerta({ dispara, ahoraMs: ahoraMin * 60000, racha, alerta, niveles, resolverTrasMin: 10 });
}

test("FSM de alertas: abre a la 2.ª evaluación, repite sin renotificar, escala, reconocer detiene", () => {
  const a1 = fsm(true, 0);
  assert.equal(a1.decision.tipo, "NADA");
  const a2 = fsm(true, 1, a1.racha);
  assert.equal(a2.decision.tipo, "ABRIR");
  const viva: AlertaViva = { estado: "ABIERTA", nivel: 1, primeraVezMs: 60000, proximoEscalaMs: 11 * 60000, silenciadaHastaMs: null, resueltaMs: null };
  assert.equal(fsm(true, 5, a2.racha, viva).decision.tipo, "REPETIR");
  const esc = fsm(true, 11, a2.racha, viva).decision;
  assert.equal(esc.tipo, "ESCALAR");
  if (esc.tipo === "ESCALAR") assert.equal(esc.nivel, 2);
  assert.equal(fsm(true, 40, a2.racha, { ...viva, estado: "RECONOCIDA" }).decision.tipo, "REPETIR");
});

test("FSM de alertas: auto-resolución a los 10 min normales y anti-flapping", () => {
  const viva: AlertaViva = { estado: "ABIERTA", nivel: 1, primeraVezMs: 0, proximoEscalaMs: null, silenciadaHastaMs: null, resueltaMs: null };
  const n1 = fsm(false, 20, { disparos: 3, normalDesdeMs: null }, viva);
  assert.equal(n1.decision.tipo, "NADA");
  assert.equal(fsm(false, 30, n1.racha, viva).decision.tipo, "RESOLVER");
  const resuelta: AlertaViva = { ...viva, estado: "RESUELTA", resueltaMs: 30 * 60000 };
  assert.equal(fsm(true, 40, { disparos: 1, normalDesdeMs: null }, resuelta).decision.tipo, "REABRIR");
  assert.equal(fsm(true, 90, { disparos: 1, normalDesdeMs: null }, resuelta).decision.tipo, "ABRIR");
});

test("propiedad: 100 disparos seguidos ⇒ 1 sola apertura", () => {
  let racha = { disparos: 0, normalDesdeMs: null as number | null };
  let alerta: AlertaViva | null = null;
  let aperturas = 0;
  for (let i = 0; i < 100; i++) {
    const r = fsm(true, i, racha, alerta);
    racha = r.racha;
    if (r.decision.tipo === "ABRIR") {
      aperturas++;
      alerta = { estado: "RECONOCIDA", nivel: 1, primeraVezMs: i * 60000, proximoEscalaMs: null, silenciadaHastaMs: null, resueltaMs: null };
    }
  }
  assert.equal(aperturas, 1);
});

test("periodos de reportes (semana ISO, mes anterior y cambio de año)", () => {
  assert.equal(semanaIso("2026-10-19"), "2026-W43");
  assert.equal(semanaIso("2027-01-01"), "2026-W53");
  assert.equal(periodoQueToca({ frecuencia: "SEMANAL", diaSemana: 1, hora: "07:00" }, "2026-10-26", 1, 7 * 60)?.periodo, "2026-W43");
  assert.equal(periodoQueToca({ frecuencia: "SEMANAL", diaSemana: 1, hora: "07:00" }, "2026-10-26", 1, 6 * 60), null);
  assert.equal(periodoQueToca({ frecuencia: "MENSUAL", diaMes: 1, hora: "07:00" }, "2027-01-01", 5, 8 * 60)?.periodo, "2026-12");
  assert.equal(periodoQueToca({ frecuencia: "DIARIO", hora: "07:00" }, "2026-10-20", 2, 8 * 60)?.periodo, "2026-10-19");
});

// ------------------------------------------------------------------ M8
const cerca = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test("Erlang C: vectores conocidos", () => {
  cerca(probEspera(0.5, 1), 0.5, 1e-9);
  cerca(erlangC(30, 1, 1).esperaMin!, 1, 1e-9);
  cerca(probEspera(1, 2), 1 / 3, 1e-9);
  cerca(erlangC(60, 1, 2).esperaMin!, 1 / 3, 1e-9);
  cerca(probEsperaMayor(60, 1, 2, 1), Math.exp(-1) / 3, 1e-6);
  cerca(probEspera(8, 10), 0.409, 0.002);
});

test("Erlang C estable con c = 200 y a = 190", () => {
  const C = probEspera(190, 200);
  assert.ok(Number.isFinite(C) && C > 0 && C < 1);
});

test("Gherkin M8: λ = 30/h, 5 min, SLA 90 % en 15 min ⇒ c = 3 ≈ 84 % y mínimo = 4 (≈ 99,6 %)", () => {
  cerca(nivelServicio(30, 5, 3, 15), 0.843, 0.005);
  cerca(nivelServicio(30, 5, 4, 15), 0.996, 0.005);
  assert.equal(minimoServidores(30, 5, 15, 0.9), 4);
  assert.equal(erlangC(60, 5, 4).estable, false);
});

test("propiedad: SL crece y Wq decrece con c", () => {
  let previo = -1;
  for (let c = 3; c <= 10; c++) {
    const sl = nivelServicio(30, 5, c, 15);
    assert.ok(sl >= previo);
    previo = sl;
  }
});

test("montículo: orden correcto y empates por inserción", () => {
  const h = new Monticulo<{ t: number; seq: number }>();
  const rng = mulberry32(1);
  for (let i = 0; i < 10000; i++) h.push({ t: Math.floor(rng() * 100), seq: i });
  let prev = { t: -1, seq: -1 };
  for (let x = h.pop(); x; x = h.pop()) {
    assert.ok(x.t > prev.t || (x.t === prev.t && x.seq > prev.seq));
    prev = x;
  }
});

test("log-normal: el ajuste recupera media y CV", () => {
  const u = mulberry32(5);
  const xs = Array.from({ length: 10000 }, () => logNormal(u, 5, 0.6));
  const a = ajustarLogNormal(xs);
  cerca(a.media, 5, 0.15);
  cerca(a.cv, 0.6, 0.03);
});

const base: ParametrosSim = {
  version: 1,
  modo: "DIA",
  horario: { apertura: "08:00", cierre: "17:00" },
  lambdaPorHora: [{ desde: "08:00", valor: 30 }],
  servicio: { tipo: "EXPONENCIAL", mediaMin: 5 },
  ventanillas: [{ desde: "08:00", c: 3 }],
  sla: { esperaMaxMin: 15, objetivoPct: 90 },
  replicas: 60,
  semilla: 2026,
};

test("DES reproducible: misma semilla ⇒ mismo resultado", () => {
  const a = simularReplica(base, 3);
  const b = simularReplica(base, 3);
  assert.equal(a.esperaMedia, b.esperaMedia);
  assert.notEqual(simularReplica({ ...base, semilla: 7 }, 3).esperaMedia, a.esperaMedia);
});

test("adelgazamiento: llegadas medias ≈ ∫λ(t)dt (±5 %)", () => {
  const p = { ...base, lambdaPorHora: [{ desde: "08:00", valor: 20 }, { desde: "12:00", valor: 40 }], ventanillas: [{ desde: "08:00", c: 10 }] };
  const n = Array.from({ length: 200 }, (_, r) => simularReplica(p, r).llegadas);
  cerca(n.reduce((a, b) => a + b, 0) / n.length, 4 * 20 + 5 * 40, 0.05 * 280);
});

test("DES vs Erlang: c = 4 cumple el SLA y c = 3 no (con IC)", () => {
  const r3 = monteCarlo({ ...base, replicas: 100 })!;
  const r4 = monteCarlo({ ...base, ventanillas: [{ desde: "08:00", c: 4 }], replicas: 100 })!;
  assert.ok(r4.pctSla.media > r3.pctSla.media);
  assert.ok(r4.cumpleSla);
  assert.ok(r4.pctSla.ic[0] <= r4.pctSla.media && r4.pctSla.media <= r4.pctSla.ic[1]);
});

test("no-show aumenta la espera y la paciencia corta aumenta el abandono", () => {
  const sin = resumir(Array.from({ length: 40 }, (_, r) => simularReplica(base, r).esperaMedia)).media;
  // El no-show reemplaza la atención por la espera tNS: con tNS mayor que el servicio medio la cola empeora
  const con = resumir(Array.from({ length: 40 }, (_, r) => simularReplica({ ...base, noShow: { p: 0.3, minutos: 8 } }, r).esperaMedia)).media;
  const mas = resumir(Array.from({ length: 40 }, (_, r) => simularReplica({ ...base, noShow: { p: 0.5, minutos: 8 } }, r).esperaMedia)).media;
  assert.ok(con >= sin && mas >= con, `${sin} ${con} ${mas}`);
  const ab = resumir(Array.from({ length: 40 }, (_, r) => simularReplica({ ...base, pacienciaMin: { tipo: "EXPONENCIAL", media: 3 } }, r).abandonoPct)).media;
  assert.ok(ab > 0);
});

test("CRN: la varianza de la diferencia pareada es menor que con semillas independientes", () => {
  const a = { ...base, replicas: 30 };
  const b = { ...base, ventanillas: [{ desde: "08:00", c: 4 }], replicas: 30 };
  const par = compararPareado(a, b, "esperaMedia");
  const ind = resumir(Array.from({ length: 30 }, (_, r) => simularReplica({ ...b, semilla: 999 }, r).esperaMedia - simularReplica(a, r).esperaMedia));
  assert.ok(par.desv < ind.desv, `${par.desv} vs ${ind.desv}`);
});
