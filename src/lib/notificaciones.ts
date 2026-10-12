import { prisma } from "@/lib/db";
import { publicar } from "@/lib/realtime";
import { enmascararTelefono } from "@/lib/crypto";
import { proveedorWhatsApp } from "@/lib/whatsapp";
import { contar } from "@/lib/metricas";
import { log } from "@/lib/log";

/**
 * Envío centralizado de avisos (D4): toda salida por WhatsApp queda registrada en `notificacion`,
 * respeta el plan (WhatsApp habilitado y cupo mensual `maxAvisosWhatsapp`, RN05/RN-M3-10) y,
 * si no hay cupo, se degrada a aviso web.
 */

export interface AvisoWhatsApp {
  localId: number;
  turnoId?: number | null;
  citaId?: number | null;
  telefonoE164: string | null;
  plantilla: string;
  parametros?: string[];
  texto: string;
  /** Las respuestas del bot dentro de la sesión no descuentan cupo (RN-M4-08). */
  cuentaCupo?: boolean;
}

export async function cupoWhatsApp(localId: number) {
  const local = await prisma.local.findUnique({ where: { id: localId }, include: { plan: true } });
  if (!local) return { habilitado: false, usados: 0, maximo: 0, restante: 0 };
  const inicioMes = new Date();
  inicioMes.setUTCDate(1);
  inicioMes.setUTCHours(5, 0, 0, 0); // 00:00 en Lima
  const usados = await prisma.notificacion.count({
    where: { localId, tipo: "WHATSAPP", estado: { not: "FALLIDO" }, createdAt: { gte: inicioMes }, plantilla: { not: "bot" } },
  });
  const maximo = local.plan.maxAvisosWhatsapp;
  return { habilitado: local.plan.whatsappHabilitado, usados, maximo, restante: Math.max(0, maximo - usados) };
}

/** Registra la notificación y la envía (o la deja como aviso web). Devuelve el canal usado. */
export async function enviarAviso(a: AvisoWhatsApp): Promise<{ via: "WHATSAPP" | "WEB"; ok: boolean; notificacionId: number }> {
  const cuentaCupo = a.cuentaCupo ?? true;
  let usaWhatsApp = !!a.telefonoE164;
  let motivoWeb: string | null = null;
  if (usaWhatsApp) {
    const cupo = await cupoWhatsApp(a.localId);
    if (!cupo.habilitado) {
      usaWhatsApp = false;
      motivoWeb = "Plan sin WhatsApp (RN05): aviso solo por web";
    } else if (cuentaCupo && cupo.restante <= 0) {
      usaWhatsApp = false;
      motivoWeb = `Cupo mensual de WhatsApp agotado (${cupo.maximo}): aviso solo por web`;
      contar("whatsapp_sin_cupo_total");
    }
  }

  const notif = await prisma.notificacion.create({
    data: {
      localId: a.localId,
      turnoId: a.turnoId ?? null,
      citaId: a.citaId ?? null,
      tipo: usaWhatsApp ? "WHATSAPP" : "WEB",
      destino: a.telefonoE164 ? enmascararTelefono(a.telefonoE164) : null,
      mensaje: a.texto,
      plantilla: a.plantilla,
      estado: usaWhatsApp ? "PENDIENTE" : "ENTREGADO",
      enviadoAt: usaWhatsApp ? null : new Date(),
      error: motivoWeb,
    },
  });

  const avisar = () =>
    a.turnoId != null &&
    publicar({ tipo: "notificacion:nueva", localId: a.localId, notificacion: { id: notif.id, turnoId: a.turnoId, mensaje: notif.mensaje, destino: notif.destino } });

  if (!usaWhatsApp || !a.telefonoE164) {
    avisar();
    return { via: "WEB", ok: true, notificacionId: notif.id };
  }

  const proveedor = proveedorWhatsApp();
  const r = await proveedor.enviar({ telefonoE164: a.telefonoE164, plantilla: a.plantilla, parametros: a.parametros ?? [], textoRenderizado: a.texto });
  await prisma.notificacion.update({
    where: { id: notif.id },
    data: r.ok ? { estado: "ENVIADO", proveedorMsgId: r.proveedorMsgId, enviadoAt: new Date() } : { estado: "FALLIDO", error: r.error },
  });
  contar("whatsapp_envios_total", { plantilla: a.plantilla, resultado: r.ok ? "ok" : "fallo" });
  if (!r.ok) log.warn("envío de WhatsApp fallido", { local_id: a.localId, plantilla: a.plantilla, error: r.error });
  avisar();

  // En modo simulador, emulamos el webhook de estado (entregado → leído)
  if (r.ok && proveedor.nombre === "mock" && process.env.NODE_ENV !== "test") {
    setTimeout(() => void prisma.notificacion.update({ where: { id: notif.id }, data: { estado: "ENTREGADO" } }).then(avisar).catch(() => {}), 1500);
    setTimeout(() => void prisma.notificacion.update({ where: { id: notif.id }, data: { estado: "LEIDO" } }).then(avisar).catch(() => {}), 4000);
  }
  return { via: "WHATSAPP", ok: r.ok, notificacionId: notif.id };
}
