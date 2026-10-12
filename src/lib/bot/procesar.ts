import { prisma } from "@/lib/db";
import { proveedorWhatsApp } from "@/lib/whatsapp";
import { emitirTurno, cancelarTurno } from "@/lib/turnos";
import { localAbierto } from "@/lib/operacion";
import { transicion, type ContextoBot } from "@/lib/bot/fsm";
import { dejarEnBandeja } from "@/lib/bot/bandeja";

const sesiones = new Map<string, ContextoBot>();

export async function procesarMensajeEntrante(telefono: string, texto: string) {
  const local = await prisma.local.findFirst({ where: { activo: true }, orderBy: { id: "asc" }, include: { colas: { where: { activa: true }, orderBy: { orden: "asc" } } } });
  if (!local) return;
  const clave = `${local.id}:${telefono}`;
  const ctx = sesiones.get(clave) ?? { estado: "INICIO" as const };
  const paso = transicion(ctx, texto, local.colas.map((c) => ({ id: c.id, nombre: c.nombre })));
  sesiones.set(clave, paso.efecto === "EMITIR" ? { estado: "INICIO" } : paso.ctx);
  let respuesta = paso.respuesta;
  if (paso.efecto === "EMITIR" && paso.ctx.colaId) {
    try {
      const turno = await emitirTurno({ colaId: paso.ctx.colaId, nombre: paso.ctx.nombre ?? null, telefono, consentimiento: true, canal: "WHATSAPP" });
      respuesta = `Tu turno es ${turno.codigo}. Síguelo aquí: /t/${turno.token}`;
    } catch (e) {
      respuesta = e instanceof Error ? e.message : "No pude emitir el turno";
    }
  }
  if (paso.efecto === "HUMANO") dejarEnBandeja(telefono, texto);
  if (paso.efecto === "HORARIO") {
    const h = await localAbierto(local.id, local.zonaHoraria);
    respuesta = h.abierto ? "Estamos atendiendo." : (h.mensaje ?? "Cerrado");
  }
  if (paso.efecto === "CANCELAR" || paso.efecto === "ESTADO") {
    const hash = (await import("@/lib/crypto")).hashTelefono(telefono.startsWith("+") ? telefono : `+51${telefono.replace(/\D/g, "").slice(-9)}`);
    const c = await prisma.cliente.findFirst({ where: { telefonoHash: hash } });
    const turno = c ? await prisma.turno.findFirst({ where: { clienteId: c.id, estado: { in: ["EMITIDO", "AVISADO", "LLAMADO"] } }, orderBy: { id: "desc" } }) : null;
    if (!turno) respuesta = "No tienes un turno activo.";
    else if (paso.efecto === "CANCELAR") {
      await cancelarTurno(turno.token);
      respuesta = `Cancelé el turno ${turno.codigo}.`;
    } else respuesta = `Tu turno ${turno.codigo} está ${turno.estado}.`;
  }
  await proveedorWhatsApp().enviar({ telefonoE164: telefono, plantilla: "bot", parametros: [], textoRenderizado: respuesta });
}
