import assert from "node:assert/strict";
import test from "node:test";
import { capacidadSlot, debeBloquear, emisionDeCita, franjasDelDia, generarIcs, pinPresencia, transicionCitaValida, validarPin, ventanaCheckin, ventanaPin } from "../../src/lib/citas/reglas";

const cfg = { checkinAntesMin: 10, checkinDespuesMin: 15, graciaNoShowMin: 10 };
const inicio = new Date("2026-10-20T15:30:00Z"); // 10:30 en Lima
const en = (min: number) => new Date(inicio.getTime() + min * 60000);

test("ventana de check-in: bordes exactos (−10 / +15 / +25)", () => {
  assert.equal(ventanaCheckin(inicio, en(-10.01), cfg).tipo, "TEMPRANO");
  assert.equal(ventanaCheckin(inicio, en(-10), cfg).tipo, "DENTRO");
  assert.equal(ventanaCheckin(inicio, en(15), cfg).tipo, "DENTRO");
  assert.equal(ventanaCheckin(inicio, en(15.01), cfg).tipo, "TARDE");
  assert.equal(ventanaCheckin(inicio, en(25), cfg).tipo, "TARDE");
  assert.equal(ventanaCheckin(inicio, en(25.01), cfg).tipo, "VENCIDA");
});

test("Gherkin: check-in temprano informa desde qué hora (10:20)", () => {
  const v = ventanaCheckin(inicio, en(-40), cfg);
  assert.equal(v.tipo, "TEMPRANO");
  if (v.tipo === "TEMPRANO") assert.equal(v.disponibleDesde.toISOString(), "2026-10-20T15:20:00.000Z");
});

test("RN-M3-05: llegar temprano no adelanta; tarde ⇒ ahora", () => {
  assert.equal(emisionDeCita(inicio, en(-5), false).getTime(), inicio.getTime());
  assert.equal(emisionDeCita(inicio, en(5), false).getTime(), en(5).getTime());
  assert.equal(emisionDeCita(inicio, en(20), true).getTime(), en(20).getTime());
});

test("transiciones de la cita", () => {
  assert.ok(transicionCitaValida("RESERVADA", "CONFIRMADA"));
  assert.ok(transicionCitaValida("CHECKIN", "ATENDIDA"));
  assert.ok(!transicionCitaValida("CANCELADA", "CHECKIN"));
  assert.ok(!transicionCitaValida("NO_SHOW", "RESERVADA"));
});

test("capacidad del slot", () => {
  assert.equal(capacidadSlot(3, 60), 1);
  assert.equal(capacidadSlot(5, 60), 3);
  assert.equal(capacidadSlot(1, 10), 1);
  assert.equal(capacidadSlot(5, 60, 4), 4);
});

test("bloqueo por reincidencia", () => {
  assert.ok(debeBloquear(3, 3));
  assert.ok(!debeBloquear(2, 3));
  assert.ok(!debeBloquear(9, 0));
});

test("franjas con bloqueo y zona horaria: un slot 23:30 en Lima cae en el día UTC siguiente", () => {
  const ahora = new Date("2026-10-19T00:00:00Z");
  const f = franjasDelDia("2026-10-20", [{ apertura: "23:00", cierre: "24:00" }], 30, "America/Lima", [], ahora);
  assert.equal(f.length, 2);
  assert.equal(f[1].inicio.toISOString(), "2026-10-21T04:30:00.000Z");
  const conBloqueo = franjasDelDia("2026-10-20", [{ apertura: "08:00", cierre: "10:00" }], 30, "America/Lima", [{ inicio: new Date("2026-10-20T13:30:00Z"), fin: new Date("2026-10-20T14:30:00Z") }], ahora);
  assert.deepEqual(conBloqueo.map((x) => x.inicio.toISOString()), ["2026-10-20T13:00:00.000Z", "2026-10-20T14:30:00.000Z"]);
});

test("PIN de presencia: misma ventana igual, ventana anterior aceptada, −2 rechazada", () => {
  const ahora = Date.parse("2026-10-20T15:27:00Z");
  const v = ventanaPin(ahora);
  const pin = pinPresencia("secreto", 1, v);
  assert.match(pin, /^\d{4}$/);
  assert.equal(pinPresencia("secreto", 1, v), pin);
  assert.ok(validarPin("secreto", 1, pin, ahora));
  assert.ok(validarPin("secreto", 1, pinPresencia("secreto", 1, v - 1), ahora));
  const viejo = pinPresencia("secreto", 1, v - 2);
  if (viejo !== pin && viejo !== pinPresencia("secreto", 1, v - 1)) assert.ok(!validarPin("secreto", 1, viejo, ahora));
  assert.notEqual(pinPresencia("secreto", 2, v), pinPresencia("otro", 2, v));
});

test(".ics válido con zona horaria y alarma", () => {
  const ics = generarIcs({ id: 7, inicio, fin: en(15), local: "Policlínico", servicio: "Medicina, general", url: "https://x/c/T", zona: "America/Lima" });
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /DTSTART;TZID=America\/Lima:20261020T103000/);
  assert.match(ics, /TRIGGER:-PT2H/);
  assert.match(ics, /Medicina\\, general/);
});
