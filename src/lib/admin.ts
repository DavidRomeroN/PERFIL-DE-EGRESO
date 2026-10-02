import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import type { Session } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ErrorNegocio } from "@/lib/turnos";

export const LOCAL_COOKIE = "turnoya_local";

/**
 * Resuelve el local sobre el que opera un administrador.
 * - ADMIN_LOCAL / OPERADOR: siempre su propio local (aislamiento multi-tenant).
 * - SUPER_ADMIN: ?localId=, luego cookie turnoya_local, luego el primer local activo.
 */
export async function localDeSesion(req: NextRequest, session: Session): Promise<number> {
  if (session.rol !== "SUPER_ADMIN") {
    if (!session.localId) throw new ErrorNegocio("SIN_LOCAL", "El usuario no tiene local asignado", 400);
    return session.localId;
  }
  const q = new URL(req.url).searchParams.get("localId");
  if (q) return Number(q);
  const cookie = (await cookies()).get(LOCAL_COOKIE)?.value;
  if (cookie && Number(cookie) > 0) return Number(cookie);
  if (session.localId) return session.localId;
  const primero = await prisma.local.findFirst({ where: { activo: true }, orderBy: { id: "asc" }, select: { id: true } });
  if (!primero) throw new ErrorNegocio("SIN_LOCAL", "No hay locales registrados", 404);
  return primero.id;
}

/** Local activo para páginas server del área admin (misma regla que localDeSesion). */
export async function localActualAdmin(session: Session) {
  let id: number | null = null;
  if (session.rol === "SUPER_ADMIN") {
    const cookie = (await cookies()).get(LOCAL_COOKIE)?.value;
    id = cookie && Number(cookie) > 0 ? Number(cookie) : null;
  } else {
    id = session.localId;
  }
  const where = id ? { id } : { activo: true };
  const local = await prisma.local.findFirst({ where, orderBy: { id: "asc" }, include: { plan: true } });
  if (!local && id && session.rol === "SUPER_ADMIN") {
    return prisma.local.findFirst({ where: { activo: true }, orderBy: { id: "asc" }, include: { plan: true } });
  }
  return local;
}

export async function registrarAuditoria(p: { localId: number | null; usuarioId: number; accion: string; entidad: string; entidadId?: string | number | null; datos?: unknown }) {
  await prisma.auditoria
    .create({
      data: {
        localId: p.localId,
        usuarioId: p.usuarioId,
        accion: p.accion,
        entidad: p.entidad,
        entidadId: p.entidadId != null ? String(p.entidadId) : null,
        datosJson: p.datos === undefined ? undefined : (JSON.parse(JSON.stringify(p.datos)) as object),
      },
    })
    .catch(() => {});
}
