import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getSession, type Session } from "@/lib/auth";
import { ErrorNegocio } from "@/lib/turnos";
import type { RolUsuario } from "@/generated/prisma/client";

/**
 * Utilidades para los route handlers de /api/v1.
 * Filtro global de errores con códigos de negocio y logs JSON con request_id.
 */

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function error(codigo: string, mensaje: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: { codigo, mensaje, ...extra } }, { status });
}

export function manejarError(e: unknown, requestId: string) {
  if (e instanceof ErrorNegocio) return error(e.codigo, e.message, e.status, e.extra);
  if (e instanceof ZodError) {
    const detalle = e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    return error("VALIDACION", detalle, 422);
  }
  if (e instanceof Error) {
    if (e.message.includes("COLA_INACTIVA")) return error("COLA_INACTIVA", "La cola no está activa", 404);
    if (e.message.includes("ux_turno_activo_cliente")) return error("TURNO_DUPLICADO", "Ya tienes un turno activo en esta cola", 409);
    if (/Unique constraint/i.test(e.message)) return error("DUPLICADO", "Ya existe un registro con esos datos", 409);
  }
  console.error(JSON.stringify({ level: "error", request_id: requestId, msg: e instanceof Error ? e.message : String(e), at: new Date().toISOString() }));
  return error("ERROR_INTERNO", "Ocurrió un error inesperado", 500);
}

export function requestId(req: NextRequest) {
  return req.headers.get("x-request-id") ?? crypto.randomUUID();
}

export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  const json = await req.json().catch(() => ({}));
  return schema.parse(json);
}

type Handler<Ctx> = (req: NextRequest, ctx: Ctx & { session: Session; requestId: string }) => Promise<Response>;
type PublicHandler<Ctx> = (req: NextRequest, ctx: Ctx & { requestId: string }) => Promise<Response>;

/** Envuelve un handler público con manejo de errores. */
export function publico<Ctx = object>(handler: PublicHandler<Ctx>) {
  return async (req: NextRequest, ctx: Ctx) => {
    const rid = requestId(req);
    try {
      return await handler(req, { ...ctx, requestId: rid });
    } catch (e) {
      return manejarError(e, rid);
    }
  };
}

/** Envuelve un handler que requiere sesión con alguno de los roles indicados. */
export function conRol<Ctx = object>(roles: RolUsuario[], handler: Handler<Ctx>) {
  return async (req: NextRequest, ctx: Ctx) => {
    const rid = requestId(req);
    try {
      const session = await getSession();
      if (!session) return error("NO_AUTENTICADO", "Inicia sesión para continuar", 401);
      if (!roles.includes(session.rol)) return error("PROHIBIDO", "No tienes permiso para esta acción", 403);
      return await handler(req, { ...ctx, session, requestId: rid });
    } catch (e) {
      return manejarError(e, rid);
    }
  };
}

export async function paramsDe<T>(ctx: { params: Promise<T> | T }): Promise<T> {
  return await ctx.params;
}

// ---------------------------------------------------------------------------
// Rate limit en memoria (5 solicitudes/min por IP para POST /public/turnos)
// ---------------------------------------------------------------------------
const globalForRate = globalThis as unknown as { turnoyaRate?: Map<string, number[]> };
const rate = globalForRate.turnoyaRate ?? new Map<string, number[]>();
globalForRate.turnoyaRate = rate;

export function rateLimit(req: NextRequest, clave: string, max = 5, ventanaMs = 60_000) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? req.headers.get("x-real-ip") ?? "local";
  const k = `${clave}:${ip}`;
  const ahora = Date.now();
  const lista = (rate.get(k) ?? []).filter((t) => ahora - t < ventanaMs);
  if (lista.length >= max) return false;
  lista.push(ahora);
  rate.set(k, lista);
  return true;
}
