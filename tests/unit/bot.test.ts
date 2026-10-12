import assert from "node:assert/strict";
import test from "node:test";
import { intencion, levenshtein, normalizar } from "../../src/lib/bot/intencion";
import { TABLA, diagramaMermaid, transicion, type EstadoBot, type Lectura } from "../../src/lib/bot/fsm";
import { adaptarMeta, adaptarOpenWA, motivoDescarte } from "../../src/lib/bot/adaptadores";
import { mulberry32 } from "../../src/lib/prediccion/cuantiles";

const L: Lectura = {
  local: "Policlínico San Román",
  colasAbiertas: [{ id: 1, nombre: "Medicina General", enEspera: 12, esperaMin: 25 }, { id: 2, nombre: "Pediatría", enEspera: 5, esperaMin: 12 }],
  turnosActivos: [],
  horarioTexto: "Lun 08:00–20:00",
  categorias: [],
  colasCita: [],
  fechasDisponibles: [],
  slots: [],
  modulos: { M1: false, M3: false },
  consentimientoPrevio: false,
};
const T = (texto: string) => ({ tipo: "TEXTO" as const, texto });

test("normalización", () => {
  assert.equal(normalizar("  ¡HOLA!!  "), "hola");
  assert.equal(normalizar("Cuánto falta??"), "cuanto falta");
  assert.equal(levenshtein("tuno", "turno"), 1);
});

test("intenciones", () => {
  assert.equal(intencion("Cuánto falta??").tipo, "POSICION");
  assert.equal(intencion("quiero sacar un tuno").tipo, "TOMAR_TURNO");
  assert.equal(intencion("👍").tipo, "SI");
  assert.equal(intencion("asdf").tipo, "OTRO");
  assert.deepEqual(intencion("2"), { tipo: "NUMERO", n: 2 });
  assert.equal(intencion("omitir").tipo, "OMITIR");
  assert.equal(intencion("ya no quiero").tipo, "CANCELAR");
});

test("Gherkin: tomar turno — hola, 1, 1, omitir, sí, sí ⇒ efecto EMITIR_TURNO", () => {
  let e: EstadoBot = "INICIO";
  let ctx = { intentos: 0 };
  const pasos = ["hola", "1", "1", "omitir", "sí", "sí"];
  let ultimo;
  for (const p of pasos) {
    ultimo = transicion(e, ctx, T(p), L);
    e = ultimo.estado;
    ctx = ultimo.ctx;
  }
  assert.deepEqual(ultimo!.efectos[0], { tipo: "EMITIR_TURNO", colaId: 1, nombre: undefined, categoria: undefined });
});

test("consentimiento negado ⇒ no se emite", () => {
  const r = transicion("PEDIR_CONSENTIMIENTO", { intentos: 0, colaId: 1, cola: "Medicina General", nombreOmitido: true }, T("no"), L);
  assert.equal(r.estado, "MENU");
  assert.equal(r.efectos.length, 0);
});

test("Gherkin: tres mensajes sin sentido ⇒ ofrece menú y asesor", () => {
  let r = transicion("MENU", { intentos: 0 }, T("asdf"), L);
  r = transicion(r.estado, r.ctx, T("qwer"), L);
  r = transicion(r.estado, r.ctx, T("zxcv"), L);
  assert.equal(r.estado, "MENU");
  assert.match(r.respuestas.join(" "), /asesor/);
});

test("Gherkin: asesor ⇒ HANDOFF y el bot calla; 'menu' lo devuelve", () => {
  const r = transicion("MENU", { intentos: 0 }, T("asesor"), L);
  assert.equal(r.estado, "HANDOFF");
  assert.deepEqual(r.efectos, [{ tipo: "HANDOFF" }]);
  const silencio = transicion("HANDOFF", r.ctx, T("hola?"), L);
  assert.equal(silencio.respuestas.length, 0);
  assert.equal(transicion("HANDOFF", r.ctx, T("menu"), L).estado, "MENU");
});

test("cancelar con confirmación", () => {
  const l = { ...L, turnosActivos: [{ token: "TOK", codigo: "A-001", cola: "Medicina", posicion: 3, esperaMin: 10, estado: "EMITIDO" }] };
  const r = transicion("MENU", { intentos: 0 }, T("3"), l);
  assert.equal(r.estado, "CONFIRMAR_CANCELAR");
  const r2 = transicion(r.estado, r.ctx, T("si"), l);
  assert.deepEqual(r2.efectos, [{ tipo: "CANCELAR_TURNO", token: "TOK" }]);
});

test("resultado de error amable (TURNO_DUPLICADO)", () => {
  const r = transicion("CONFIRMAR_TURNO", { intentos: 0 }, { tipo: "RESULTADO", ok: false, codigo: "TURNO_DUPLICADO" }, L);
  assert.match(r.respuestas[0], /Ya tienes un turno/);
});

test("propiedad: desde cualquier estado 'menu' lleva a MENU (sin estados muertos)", () => {
  const estados = [...new Set(TABLA.flatMap(([a, , b]) => [a, b]))];
  for (const e of estados) assert.equal(transicion(e, { intentos: 0 }, T("menu"), L).estado, "MENU", e);
});

test("fuzz: 10 000 cadenas raras nunca lanzan excepción", () => {
  const rng = mulberry32(42);
  const estados = [...new Set(TABLA.map(([a]) => a))];
  const piezas = ["😀", "\u0000", "مرحبا", "1", "sí", " ", "\n", "x".repeat(50000), "<script>", "'; DROP TABLE turno; --"];
  for (let i = 0; i < 10000; i++) {
    const s = Array.from({ length: 1 + Math.floor(rng() * 4) }, () => piezas[Math.floor(rng() * piezas.length)]).join("");
    const e = estados[Math.floor(rng() * estados.length)];
    const r = transicion(e, { intentos: Math.floor(rng() * 3) }, T(s), L);
    assert.ok(Array.isArray(r.respuestas));
  }
});

test("diagrama Mermaid generado desde la tabla", () => {
  assert.match(diagramaMermaid(), /^stateDiagram-v2/);
});

test("adaptador OpenWA (message.received) y descarte de grupos/propios/viejos", () => {
  const ahora = Date.now();
  const m = adaptarOpenWA({ event: "message.received", sessionId: "turnoya", data: { id: "M1", sender: "51951234567@c.us", chatId: "51951234567@c.us", body: "hola", type: "chat", fromMe: false, timestamp: Math.floor(ahora / 1000) } })!;
  assert.equal(m.desde, "+51951234567");
  assert.equal(motivoDescarte(m, ahora), null);
  assert.equal(motivoDescarte({ ...m, esGrupo: true }, ahora), "GRUPO");
  assert.equal(motivoDescarte({ ...m, propio: true }, ahora), "PROPIO");
  assert.equal(motivoDescarte({ ...m, tsMs: ahora - 6 * 60000 }, ahora), "VIEJO");
  assert.equal(adaptarOpenWA({ event: "message.ack", data: {} }), null);
});

test("adaptador Meta", () => {
  const ms = adaptarMeta({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "123" }, messages: [{ from: "51951234567", id: "wamid.1", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "1" } }] } }] }] });
  assert.equal(ms.length, 1);
  assert.equal(ms[0].canalId, "123");
  assert.equal(ms[0].texto, "1");
});
