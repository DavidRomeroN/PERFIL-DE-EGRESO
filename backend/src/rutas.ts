import type { NextRequest } from "next/server";
import { conRol, type Contexto } from "@backend/api";
import { localDeSesion } from "@backend/admin";
import { exigirModulo } from "@backend/modulos";
import type { Session } from "@backend/auth";
import type { ModuloCodigo, RolUsuario } from "@backend/generated/prisma/client";

/**
 * Envoltorio para rutas de staff que operan sobre "su" local (aislamiento multi-tenant, §9.2):
 * el local sale SIEMPRE de la sesión (o del selector del super-admin), nunca del cuerpo de la petición,
 * y si se indica un módulo se exige que esté activo (403 MODULO_NO_DISPONIBLE).
 */
export function enLocal<Ctx = object>(
  roles: RolUsuario[],
  modulo: ModuloCodigo | null,
  handler: (req: NextRequest, ctx: Ctx & Contexto & { session: Session; localId: number }) => Promise<Response>,
) {
  return conRol<Ctx>(roles, async (req, ctx) => {
    const localId = await localDeSesion(req, ctx.session);
    if (modulo) await exigirModulo(localId, modulo);
    return handler(req, { ...ctx, localId });
  });
}

export const ADMIN: RolUsuario[] = ["ADMIN_LOCAL", "SUPER_ADMIN"];
export const STAFF: RolUsuario[] = ["OPERADOR", "ADMIN_LOCAL", "SUPER_ADMIN"];

export function q(req: NextRequest, k: string) {
  return new URL(req.url).searchParams.get(k);
}

export function qNum(req: NextRequest, k: string) {
  const v = q(req, k);
  return v && /^\d+$/.test(v) ? Number(v) : null;
}
