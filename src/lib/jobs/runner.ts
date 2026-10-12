import { prisma } from "@/lib/db";
import { expirarLlamados } from "@/lib/operacion";
import { purgarDatosPersonales } from "@/lib/turnos";
import { reentrenar } from "@/lib/prediccion/modelo";
import { proveedorWhatsApp } from "@/lib/whatsapp";
import { sugerirMovimiento } from "@/lib/balanceo/reglas";
import { modeloActual } from "@/lib/prediccion/modelo";
import { descifrar } from "@/lib/crypto";

const avisosCita = new Set<string>();
const avisadosMinutos = new Set<number>();
let ultimoBalanceo = 0;

let ocupado = false;

/** Un solo ciclo de trabajos. El candado en memoria evita solapes dentro del mismo proceso. */
export async function correrJobs() {
  if (ocupado) return { omitido: true };
  ocupado = true;
  try {
    await prisma.$executeRaw`INSERT INTO job_interno (nombre) VALUES ('ciclo')`.catch(() => {});
    const vencidos = await expirarLlamados();
    const limite = new Date(Date.now() - 15 * 60 * 1000);
    const noShow = await prisma.cita.updateMany({
      where: { estado: { in: ["RESERVADA", "CONFIRMADA"] }, inicio: { lt: limite } },
      data: { estado: "NO_SHOW" },
    });
    const hora = new Date().getHours();
    let purgados = 0;
    if (hora === 3) purgados = await purgarDatosPersonales(90);
    const llamados = await prisma.turno.findMany({ where: { estado: "LLAMADO", llamadoAt: { not: null } }, select: { localId: true, llamadoAt: true } });
    const porLocal = new Map<number, number[]>();
    for (const t of llamados) {
      const min = (Date.now() - t.llamadoAt!.getTime()) / 60000;
      porLocal.set(t.localId, [...(porLocal.get(t.localId) ?? []), min]);
    }
    for (const [localId, xs] of porLocal) {
      const media = xs.reduce((s, x) => s + x, 0) / xs.length;
      if (media <= 20) continue;
      const reciente = await prisma.auditoria.findFirst({ where: { localId, accion: "ALERTA_SLA", createdAt: { gte: new Date(Date.now() - 3600_000) } } });
      if (!reciente) {
        await prisma.auditoria.create({ data: { localId, accion: "ALERTA_SLA", entidad: "local", entidadId: String(localId), datosJson: { esperaMin: Math.round(media) } } });
      }
    }
    const muestra = await prisma.turno.findMany({ where: { estado: "ATENDIDO", llamadoAt: { not: null } }, select: { emitidoAt: true, llamadoAt: true }, take: 100, orderBy: { id: "desc" } });
    const pares = muestra
      .map((t) => ({ min: (t.llamadoAt!.getTime() - t.emitidoAt.getTime()) / 60000, hora: t.emitidoAt.getHours() }))
      .filter((p) => p.min > 0 && p.min < 240);
    reentrenar(pares.map((p) => p.min), pares.map((p) => p.hora));
    const pronto = await prisma.cita.findMany({
      where: { estado: { in: ["RESERVADA", "CONFIRMADA"] }, telefono: { not: null }, inicio: { gt: new Date(), lt: new Date(Date.now() + 26 * 3600_000) } },
    });
    for (const c of pronto) {
      const faltaH = (c.inicio.getTime() - Date.now()) / 3600000;
      const clave = `${c.id}:${faltaH < 3 ? "2h" : "24h"}`;
      const toca = (faltaH < 2.2 && faltaH > 1.8) || (faltaH < 24.5 && faltaH > 23.5);
      if (!toca || avisosCita.has(clave) || !c.telefono) continue;
      avisosCita.add(clave);
      await proveedorWhatsApp().enviar({ telefonoE164: c.telefono, plantilla: "bot", parametros: [], textoRenderizado: `Recordatorio: tu cita es ${c.inicio.toLocaleString("es-PE")}. PIN ${c.token.slice(-4).toUpperCase()}` });
    }
    if (Date.now() - ultimoBalanceo > 30 * 60 * 1000) {
      const locales = await prisma.local.findMany({ where: { activo: true }, select: { id: true } });
      for (const local of locales) {
        const colas = await prisma.cola.findMany({
          where: { localId: local.id, activa: true },
          include: { _count: { select: { turnos: { where: { estado: { in: ["EMITIDO", "AVISADO"] } } } } }, ventanillas: true },
        });
        const mov = sugerirMovimiento(colas.map((c) => ({ colaId: c.id, enEspera: c._count.turnos, ventanillas: c.ventanillas.length })), 8);
        const ventanilla = mov && await prisma.ventanilla.findFirst({ where: { localId: local.id, colaId: mov.desde, activa: true } });
        if (mov && ventanilla && colas.filter((c) => c.id === mov.desde)[0].ventanillas.length >= 2) {
          await prisma.ventanilla.update({ where: { id: ventanilla.id }, data: { colaId: mov.hacia } });
          ultimoBalanceo = Date.now();
        }
      }
    }
    const media = modeloActual().mediaMin;
    const espera = await prisma.turno.findMany({
      where: { estado: { in: ["EMITIDO", "AVISADO"] }, cliente: { telefonoCifrado: { not: null } } },
      include: { cliente: true, cola: true },
      take: 40,
    });
    for (const t of espera) {
      if (avisadosMinutos.has(t.id) || !t.cliente?.telefonoCifrado) continue;
      const delante = await prisma.turno.count({ where: { colaId: t.colaId, estado: { in: ["EMITIDO", "AVISADO"] }, claveOrden: { gt: t.claveOrden } } });
      if (delante * media > 10) continue;
      avisadosMinutos.add(t.id);
      const tel = descifrar(t.cliente.telefonoCifrado);
      if (!tel) continue;
      await proveedorWhatsApp().enviar({ telefonoE164: tel, plantilla: "turno_proximo", parametros: [], textoRenderizado: `Tu turno ${t.codigo} está a unos ${Math.max(1, Math.round(delante * media))} minutos.` });
    }
    return { vencidos, citasNoShow: noShow.count, purgados };
  } finally {
    ocupado = false;
  }
}
