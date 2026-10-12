import { paramsDe, publico } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ErrorNegocio } from "@/lib/turnos";

export const GET = publico<{ params: Promise<{ token: string }> }>(async (_req, ctx) => {
  const { token } = await paramsDe(ctx);
  const cita = await prisma.cita.findUnique({ where: { token }, include: { local: true } });
  if (!cita) throw new ErrorNegocio("NO_ENCONTRADO", "La cita no existe", 404);
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    `DTSTART:${cita.inicio.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTEND:${cita.fin.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `SUMMARY:Cita en ${cita.local.nombreComercial}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return new Response(ics, { headers: { "Content-Type": "text/calendar" } });
});
