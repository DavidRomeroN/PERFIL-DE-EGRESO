import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { suscribir, type EventoRealtime } from "@/lib/realtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/realtime/:slug — canal de eventos en tiempo real (Server-Sent Events).
 * Eventos: cola:actualizada · turno:llamado · turno:estado · notificacion:nueva
 * El cliente (TV, panel, "mi turno") se reconecta automáticamente con EventSource.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const local = await prisma.local.findUnique({ where: { slug }, select: { id: true, activo: true } });
  if (!local || !local.activo) return new Response("Local no encontrado", { status: 404 });

  const encoder = new TextEncoder();
  let cerrar: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enviar = (evento: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${evento}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* stream cerrado */
        }
      };

      enviar("conectado", { localId: local.id, at: new Date().toISOString() });

      const off = suscribir(local.id, (e: EventoRealtime) => enviar(e.tipo, e));
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          /* ignore */
        }
      }, 20_000);

      cerrar = () => {
        clearInterval(ping);
        off();
        try {
          controller.close();
        } catch {
          /* ya cerrado */
        }
      };
      req.signal.addEventListener("abort", () => cerrar?.());
    },
    cancel() {
      cerrar?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
