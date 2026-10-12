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
  const filas = await prisma.auditoria.findMany({ where: { localId: local.id }, orderBy: { createdAt: "desc" }, take: 80, include: { usuario: { select: { nombre: true } } } });
  return (
    <div>
      <h1 className="text-2xl font-semibold">Auditoría</h1>
      <table className="mt-4 w-full text-sm">
        <tbody>
          {filas.map((f) => (
            <tr key={f.id} className="border-b">
              <td className="py-2">{f.createdAt.toLocaleString("es-PE")}</td>
              <td>{f.usuario?.nombre ?? "sistema"}</td>
              <td>{f.accion}</td>
              <td>{f.entidad} {f.entidadId}</td>
            </tr>
          ))}
          {filas.length === 0 && <tr><td className="py-6 text-muted-foreground">Aún no hay eventos.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
