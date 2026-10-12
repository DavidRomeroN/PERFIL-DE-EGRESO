import { prisma } from "../../src/lib/db";
import { invalidarModulos } from "../../src/lib/modulos";
import { sembrarPrioridades } from "../../src/lib/prioridades/service";
import type { ModuloCodigo } from "../../src/generated/prisma/client";

/** Factorías de datos: cada prueba crea su propio local (no depende del orden ni de otras pruebas). */

let n = 0;
const sufijo = () => `${Date.now().toString(36)}${(n++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export async function planPro() {
  const p = await prisma.plan.upsert({
    where: { codigo: "PRO_TEST" },
    create: { codigo: "PRO_TEST", nombre: "Pro (pruebas)", precioMensual: 149, maxTurnosMes: 100000, maxColas: 99, maxVentanillas: 10, whatsappHabilitado: true, maxAvisosWhatsapp: 3000, reportes: true },
    update: {},
  });
  const todos: ModuloCodigo[] = ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8"];
  await prisma.planModulo.createMany({ data: todos.map((modulo) => ({ planId: p.id, modulo })), skipDuplicates: true });
  return p;
}

export async function crearLocal(opciones: { modulos?: ModuloCodigo[]; colas?: number; ventanillasPorCola?: number } = {}) {
  const plan = await planPro();
  const s = sufijo();
  const local = await prisma.local.create({ data: { slug: `t-${s}`, razonSocial: `Prueba ${s}`, nombreComercial: `Local ${s}`, planId: plan.id, tiempoAusenciaSeg: null } });
  const modulos = opciones.modulos ?? [];
  if (modulos.length) await prisma.localModulo.createMany({ data: modulos.map((modulo) => ({ localId: local.id, modulo, habilitado: true })) });
  invalidarModulos(local.id);
  if (modulos.includes("M1") || modulos.includes("M3")) await sembrarPrioridades(local.id);
  const colas = [];
  for (let i = 0; i < (opciones.colas ?? 1); i++) {
    const cola = await prisma.cola.create({ data: { localId: local.id, prefijo: String.fromCharCode(65 + i), nombre: `Cola ${i + 1}`, orden: i } });
    const ventanillas = [];
    for (let v = 0; v < (opciones.ventanillasPorCola ?? 1); v++) ventanillas.push(await prisma.ventanilla.create({ data: { localId: local.id, nombre: `V${i + 1}.${v + 1}`, colaId: cola.id } }));
    colas.push({ ...cola, ventanillas });
  }
  return { local, colas };
}

export function telefonoAleatorio() {
  return `9${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
}

export async function cerrar() {
  await prisma.$disconnect();
}
