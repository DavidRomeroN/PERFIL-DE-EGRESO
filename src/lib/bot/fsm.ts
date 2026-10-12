export type EstadoBot = "INICIO" | "ELIGE_COLA" | "PIDE_NOMBRE" | "LISTO";

export interface ContextoBot {
  estado: EstadoBot;
  colaId?: number;
  nombre?: string;
}

const MENU = "Escribe:\n1 Tomar turno\n2 Ver mi turno\n3 Cancelar mi turno\n4 Horario\n0 Hablar con una persona";

export function transicion(ctx: ContextoBot, texto: string, colas: { id: number; nombre: string }[]): { ctx: ContextoBot; respuesta: string; efecto?: "EMITIR" | "ESTADO" | "CANCELAR" | "HORARIO" | "HUMANO" } {
  const t = texto.trim().toLowerCase();
  if (t === "menu" || t === "hola" || t === "0") {
    if (t === "0") return { ctx: { estado: "INICIO" }, respuesta: "Te paso con el personal. Espera un momento.", efecto: "HUMANO" };
    return { ctx: { estado: "INICIO" }, respuesta: MENU };
  }
  if (ctx.estado === "INICIO" || t === "1" || t === "turno") {
    if (t === "2") return { ctx, respuesta: "Consulto tu turno.", efecto: "ESTADO" };
    if (t === "3") return { ctx, respuesta: "Cancelo tu turno activo.", efecto: "CANCELAR" };
    if (t === "4") return { ctx, respuesta: "Reviso el horario.", efecto: "HORARIO" };
    if (colas.length === 0) return { ctx: { estado: "INICIO" }, respuesta: "Este local no tiene colas activas." };
    const lista = colas.map((c, i) => `${i + 1}. ${c.nombre}`).join("\n");
    return { ctx: { estado: "ELIGE_COLA" }, respuesta: `Elige el servicio:\n${lista}` };
  }
  if (ctx.estado === "ELIGE_COLA") {
    const n = Number(t);
    const cola = colas[n - 1];
    if (!cola) return { ctx, respuesta: "Número inválido. " + MENU };
    return { ctx: { estado: "PIDE_NOMBRE", colaId: cola.id }, respuesta: "¿Cuál es tu nombre? (o escribe - para omitirlo)" };
  }
  if (ctx.estado === "PIDE_NOMBRE") {
    return { ctx: { estado: "LISTO", colaId: ctx.colaId, nombre: t === "-" ? undefined : texto.trim().slice(0, 60) }, respuesta: "Genero tu turno…", efecto: "EMITIR" };
  }
  return { ctx: { estado: "INICIO" }, respuesta: MENU };
}
