import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { localActualAdmin } from "@/lib/admin";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getSession();
  if (!session) redirect("/login");
  const local = await localActualAdmin(session);
  if (!local) redirect("/admin/locales");
  const valoraciones = await prisma.valoracion.findMany({ where: { turno: { localId: local.id } }, select: { estrellas: true } });
  const promedio = valoraciones.length ? valoraciones.reduce((s, v) => s + v.estrellas, 0) / valoraciones.length : 0;
  const porEstado = await prisma.turno.groupBy({ by: ["estado"], where: { localId: local.id }, _count: true });
  const recientes = await prisma.turno.findMany({ where: { localId: local.id }, select: { emitidoAt: true }, take: 400, orderBy: { id: "desc" } });
  const calor = Array.from({ length: 12 }, (_, i) => ({ hora: i + 8, n: recientes.filter((t) => t.emitidoAt.getHours() === i + 8).length }));
  const max = Math.max(1, ...calor.map((c) => c.n));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Analítica y satisfacción</h1>
      <p className="text-sm text-muted-foreground">CSAT medio {promedio.toFixed(1)} de 5 · {valoraciones.length} valoraciones</p>
      <a className="text-sm underline" href="/api/v1/reportes/pdf">Descargar reporte PDF</a>
      <form action="/api/v1/reportes/correo" method="post"><button className="text-sm underline" type="submit">Enviar reporte por correo</button></form>
      <p className="text-xs text-muted-foreground">El correo sale si SMTP_HOST y REPORTE_EMAIL están configurados.</p>
      <ul className="grid gap-2 sm:grid-cols-3">
        {porEstado.map((e) => (
          <li key={e.estado} className="rounded-2xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{e.estado}</p>
            <p className="text-2xl font-semibold">{e._count}</p>
          </li>
        ))}
      </ul>
      <h2 className="font-semibold">Llegadas por hora</h2>
      <div className="flex items-end gap-1 h-24">
        {calor.map((c) => (
          <div key={c.hora} className="flex-1 rounded-t bg-teal-700" style={{ height: `${(c.n / max) * 100}%` }} title={`${c.hora}:00 · ${c.n}`} />
        ))}
      </div>
    </div>
  );
}
