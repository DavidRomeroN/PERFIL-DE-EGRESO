import { randomUUID } from "crypto";
import { prisma } from "@backend/db";
import { ErrorNegocio } from "@backend/errores";
import { hashPassword } from "@backend/auth";
import { invalidarModulos } from "@backend/modulos";
import { log } from "@backend/log";
import { contar } from "@backend/metricas";
import { ESTADOS, crearPago, mensajeRechazo, obtenerPago, type DatosTarjeta, type PagoMP } from "@backend/pagos/mercadopago";
import { Prisma } from "@backend/generated/prisma/client";

/**
 * Suscripciones: alta de un local nuevo (gratis o pagando el primer mes) y cambio/renovación de plan.
 * Un pago APROBADO se aplica una sola vez (columna `aplicado_at`), venga de la respuesta directa o del webhook.
 */

export interface DatosRegistro {
  plan: string;
  nombreComercial: string;
  razonSocial: string;
  ruc?: string | null;
  rubro: string;
  ciudad: string;
  direccion?: string | null;
  telefono?: string | null;
  slug: string;
  adminNombre: string;
  adminEmail: string;
  password: string;
}

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Mercado Pago solo acepta notification_url públicas (https); en localhost se omite y se confía en la respuesta directa. */
function urlNotificacion() {
  const u = appUrl();
  return u.startsWith("https://") ? `${u}/api/v1/webhooks/mercadopago` : undefined;
}

async function validarDisponibilidad(d: Pick<DatosRegistro, "slug" | "adminEmail">) {
  const [slug, email] = await Promise.all([
    prisma.local.findUnique({ where: { slug: d.slug }, select: { id: true } }),
    prisma.usuario.findUnique({ where: { email: d.adminEmail.toLowerCase() }, select: { id: true } }),
  ]);
  if (slug) throw new ErrorNegocio("SLUG_OCUPADO", "Esa dirección web ya está en uso; elige otra", 409);
  if (email) throw new ErrorNegocio("EMAIL_OCUPADO", "Ya existe una cuenta con ese correo; inicia sesión", 409);
}

type RegistroGuardado = Omit<DatosRegistro, "password"> & { hashPassword: string };

/** Crea el local con su admin, categorías, horario, configuración y los módulos del plan encendidos. */
async function crearLocal(tx: Prisma.TransactionClient, r: RegistroGuardado, planId: number, venceAt: Date | null) {
  const plan = await tx.plan.findUniqueOrThrow({ where: { id: planId }, include: { modulos: true } });
  const local = await tx.local.create({
    data: {
      slug: r.slug,
      ruc: r.ruc || null,
      razonSocial: r.razonSocial,
      nombreComercial: r.nombreComercial,
      rubro: r.rubro,
      ciudad: r.ciudad,
      direccion: r.direccion || null,
      telefono: r.telefono || null,
      planId: plan.id,
      planVenceAt: venceAt,
      tiempoAusenciaSeg: null,
    },
  });
  await tx.usuario.create({ data: { localId: local.id, email: r.adminEmail.toLowerCase(), hashPassword: r.hashPassword, nombre: r.adminNombre, rol: "ADMIN_LOCAL" } });
  await tx.cola.create({ data: { localId: local.id, prefijo: "A", nombre: "Atención general", orden: 1 } });
  await tx.horarioLocal.createMany({ data: [1, 2, 3, 4, 5, 6].map((diaSemana) => ({ localId: local.id, diaSemana, apertura: "08:00", cierre: "18:00" })) });
  if (plan.modulos.length) await tx.localModulo.createMany({ data: plan.modulos.map((m) => ({ localId: local.id, modulo: m.modulo, habilitado: true })) });
  const { sembrarPrioridades } = await import("@backend/prioridades/service");
  await sembrarPrioridades(local.id, tx);
  return local;
}

function sumarMeses(desde: Date, meses: number) {
  const d = new Date(desde);
  d.setUTCMonth(d.getUTCMonth() + meses);
  return d;
}

/** Aplica un pago aprobado (idempotente): crea el local del registro o extiende/cambia el plan del local. */
export async function aplicarPago(pagoId: number) {
  return prisma.$transaction(async (tx) => {
    const filas = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM pago WHERE id = ${pagoId}::int AND estado = 'APROBADO' AND aplicado_at IS NULL FOR UPDATE`;
    if (!filas.length) return null;
    const pago = await tx.pago.findUniqueOrThrow({ where: { id: pagoId } });
    let localId = pago.localId;
    if (!localId && pago.registro) {
      const local = await crearLocal(tx, pago.registro as unknown as RegistroGuardado, pago.planId, sumarMeses(new Date(), pago.meses));
      localId = local.id;
    } else if (localId) {
      const local = await tx.local.findUniqueOrThrow({ where: { id: localId } });
      const base = local.planId === pago.planId && local.planVenceAt && local.planVenceAt > new Date() ? local.planVenceAt : new Date();
      await tx.local.update({ where: { id: localId }, data: { planId: pago.planId, planVenceAt: sumarMeses(base, pago.meses) } });
      // Al subir de plan se encienden los módulos nuevos que incluye
      const modulos = await tx.planModulo.findMany({ where: { planId: pago.planId } });
      for (const m of modulos) {
        await tx.localModulo.upsert({ where: { localId_modulo: { localId, modulo: m.modulo } }, create: { localId, modulo: m.modulo, habilitado: true }, update: {} });
      }
    }
    await tx.pago.update({ where: { id: pagoId }, data: { localId, aplicadoAt: new Date(), registro: pago.registro ? { aplicado: true } : undefined } });
    await tx.auditoria.create({ data: { localId, accion: "PAGO_APLICADO", entidad: "pago", entidadId: String(pagoId), accionHumana: `Pago de S/ ${pago.monto} aplicado (plan ${pago.planId}, ${pago.meses} mes)` } });
    return localId;
  }).then((localId) => {
    if (localId) invalidarModulos(localId);
    return localId;
  });
}

async function registrarResultado(pagoId: number, mp: PagoMP) {
  const estado = ESTADOS[mp.status] ?? "PENDIENTE";
  await prisma.pago.update({
    where: { id: pagoId },
    data: {
      proveedorPagoId: String(mp.id),
      estado,
      estadoDetalle: mp.status_detail,
      metodo: mp.payment_method_id,
      ultimos4: mp.card?.last_four_digits ?? null,
      // Un registro rechazado no se aplicará nunca: se borran los datos (incluida la contraseña hasheada)
      ...(estado === "RECHAZADO" || estado === "CANCELADO" ? { registro: Prisma.DbNull } : {}),
    },
  });
  contar("pagos_total", { estado });
  if (estado === "APROBADO") await aplicarPago(pagoId);
  return estado;
}

/**
 * Alta de un local. Plan gratuito: se crea de inmediato. Plan pagado: se cobra el primer mes con la tarjeta tokenizada;
 * si queda en proceso, el local se crea cuando el webhook confirme la aprobación.
 */
export async function registrar(d: DatosRegistro, tarjeta: DatosTarjeta | null, claveIdem: string) {
  const plan = await prisma.plan.findUnique({ where: { codigo: d.plan } });
  if (!plan) throw new ErrorNegocio("PLAN_INVALIDO", "El plan no existe", 404);
  const previo = await prisma.pago.findUnique({ where: { claveIdem } });
  if (previo) return resultado(previo.id);
  await validarDisponibilidad(d);
  const { password, ...resto } = d;
  const registro: RegistroGuardado = { ...resto, adminEmail: d.adminEmail.toLowerCase(), hashPassword: await hashPassword(password) };
  const monto = Number(plan.precioMensual);

  if (monto === 0) {
    const local = await prisma.$transaction((tx) => crearLocal(tx, registro, plan.id, null));
    invalidarModulos(local.id);
    return { estado: "APROBADO" as const, slug: local.slug, mensaje: "Tu local está listo. Inicia sesión con tu correo." };
  }
  if (!tarjeta) throw new ErrorNegocio("PAGO_REQUERIDO", "Ingresa los datos de la tarjeta para pagar el primer mes", 422);

  const pago = await prisma.pago.create({
    data: { planId: plan.id, claveIdem, monto: plan.precioMensual, emailPagador: tarjeta.payer.email, registro: registro as unknown as Prisma.InputJsonValue },
  });
  try {
    const mp = await crearPago({ tarjeta, monto, descripcion: `TurnoYa · Plan ${plan.nombre} · 1 mes`, referencia: `pago-${pago.id}`, idempotencia: claveIdem, urlNotificacion: urlNotificacion() });
    await registrarResultado(pago.id, mp);
  } catch (e) {
    await prisma.pago.update({ where: { id: pago.id }, data: { estado: "RECHAZADO", estadoDetalle: e instanceof Error ? e.message.slice(0, 200) : "error", registro: Prisma.DbNull } });
    throw e;
  }
  return resultado(pago.id);
}

/** Cambio o renovación del plan de un local existente (admin). */
export async function pagarPlan(localId: number, codigoPlan: string, meses: number, tarjeta: DatosTarjeta, claveIdem: string, usuarioId: number) {
  const plan = await prisma.plan.findUnique({ where: { codigo: codigoPlan } });
  if (!plan || Number(plan.precioMensual) === 0) throw new ErrorNegocio("PLAN_INVALIDO", "Elige un plan de pago", 422);
  const previo = await prisma.pago.findUnique({ where: { claveIdem } });
  if (previo) return resultado(previo.id);
  const m = Math.max(1, Math.min(12, meses));
  const monto = Number(plan.precioMensual) * m;
  const pago = await prisma.pago.create({ data: { localId, planId: plan.id, claveIdem, monto, meses: m, emailPagador: tarjeta.payer.email } });
  try {
    const mp = await crearPago({ tarjeta, monto, descripcion: `TurnoYa · Plan ${plan.nombre} · ${m} mes${m > 1 ? "es" : ""}`, referencia: `pago-${pago.id}`, idempotencia: claveIdem, urlNotificacion: urlNotificacion() });
    await registrarResultado(pago.id, mp);
  } catch (e) {
    await prisma.pago.update({ where: { id: pago.id }, data: { estado: "RECHAZADO", estadoDetalle: e instanceof Error ? e.message.slice(0, 200) : "error" } });
    throw e;
  }
  log.info("pago de plan", { local_id: localId, usuario_id: usuarioId, plan: plan.codigo, meses: m });
  return resultado(pago.id);
}

export async function resultado(pagoId: number) {
  const p = await prisma.pago.findUniqueOrThrow({ where: { id: pagoId }, include: { local: { select: { slug: true } } } });
  const mensaje =
    p.estado === "APROBADO" ? (p.local ? "¡Pago aprobado! Tu plan ya está activo." : "Pago aprobado.")
    : p.estado === "EN_PROCESO" || p.estado === "PENDIENTE" ? "Tu pago está en revisión. Te avisaremos apenas se apruebe (normalmente en minutos)."
    : mensajeRechazo(p.estadoDetalle ?? "");
  return { estado: p.estado, pagoId: p.id, slug: p.local?.slug ?? null, mensaje, ultimos4: p.ultimos4 };
}

/** Webhook: se vuelve a consultar el pago a Mercado Pago (no se confía en el cuerpo de la notificación). */
export async function procesarNotificacion(mpPagoId: string) {
  const mp = await obtenerPago(mpPagoId);
  const ref = mp.external_reference?.match(/^pago-(\d+)$/);
  const pago = ref ? await prisma.pago.findUnique({ where: { id: Number(ref[1]) } }) : await prisma.pago.findUnique({ where: { proveedorPagoId: String(mp.id) } });
  if (!pago) return { ignorado: true };
  return { estado: await registrarResultado(pago.id, mp) };
}

export async function historialPagos(localId: number) {
  return prisma.pago.findMany({ where: { localId }, orderBy: { creadoAt: "desc" }, take: 24, include: { plan: { select: { nombre: true } } } });
}

export function nuevaClaveIdem() {
  return randomUUID();
}
