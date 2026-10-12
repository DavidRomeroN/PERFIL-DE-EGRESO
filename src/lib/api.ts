import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getSession, type Session } from "@/lib/auth";
import { ErrorNegocio } from "@/lib/errores";
import { prisma } from "@/lib/db";
import { log } from "@/lib/log";
import { contar } from "@/lib/metricas";
import type { Prisma, RolUsuario } from "@/generated/prisma/client";

/**
 * Utilidades para los route handlers de /api/v1.
 * Filtro global de errores con códigos de negocio y logs JSON con request_id.
 */

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function error(codigo: string, mensaje: string, status = 400, extra?: Record<string, unknown>) {
  contar("api_errores_total", { codigo });
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
  log.error(e instanceof Error ? e.message : String(e), { request_id: requestId, stack: e instanceof Error ? e.stack?.split("\n").slice(0, 4).join(" | ") : undefined });
  return error("ERROR_INTERNO", "Ocurrió un error inesperado", 500);
}

export function requestId(req: NextRequest) {
  return req.headers.get("x-request-id") ?? crypto.randomUUID();
}

export function ipDe(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  const json = await req.json().catch(() => ({}));
  return schema.parse(json);
}

export interface Contexto {
  requestId: string;
  ip: string;
}

type Handler<Ctx> = (req: NextRequest, ctx: Ctx & Contexto & { session: Session }) => Promise<Response>;
type PublicHandler<Ctx> = (req: NextRequest, ctx: Ctx & Contexto) => Promise<Response>;

/** Envuelve un handler público con manejo de errores. */
export function publico<Ctx = object>(handler: PublicHandler<Ctx>) {
  return async (req: NextRequest, ctx: Ctx) => {
    const rid = requestId(req);
    try {
      return await handler(req, { ...ctx, requestId: rid, ip: ipDe(req) });
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
      return await handler(req, { ...ctx, session, requestId: rid, ip: ipDe(req) });
    } catch (e) {
      return manejarError(e, rid);
    }
  };
}

export async function paramsDe<T>(ctx: { params: Promise<T> | T }): Promise<T> {
  return await ctx.params;
}

// ---------------------------------------------------------------------------
// F7 · Límite de peticiones persistente (ventana fija de 1 minuto por clave e IP).
// Se guarda en `rate_limit`, así sobrevive a reinicios y sirve con varias instancias.
// ---------------------------------------------------------------------------
export async function rateLimit(req: NextRequest, clave: string, max = 5, ventanaMs = 60_000) {
  const k = `${clave}:${ipDe(req)}`;
  const ventana = new Date(Math.floor(Date.now() / ventanaMs) * ventanaMs);
  try {
    const rows = await prisma.$queryRaw<{ contador: number }[]>`
      INSERT INTO rate_limit (clave, ventana, contador) VALUES (${k}, ${ventana}, 1)
      ON CONFLICT (clave, ventana) DO UPDATE SET contador = rate_limit.contador + 1
      RETURNING contador`;
    const permitido = (rows[0]?.contador ?? 1) <= max;
    if (!permitido) contar("rate_limit_bloqueos_total", { clave });
    return permitido;
  } catch (e) {
    // Si la BD falla no se bloquea al usuario por el límite (el error real aparecerá en la operación)
    log.warn("rate_limit sin BD", { error: e instanceof Error ? e.message : String(e) });
    return true;
  }
}

// ---------------------------------------------------------------------------
// ADR-04 · Idempotencia: misma `Idempotency-Key` + ruta ⇒ misma respuesta durante 24 h.
// ---------------------------------------------------------------------------
export async function conIdempotencia(req: NextRequest, ruta: string, fn: () => Promise<{ status: number; data: unknown }>, clave?: string | null) {
  const k = clave ?? req.headers.get("idempotency-key");
  if (!k) {
    const r = await fn();
    return ok(r.data, { status: r.status });
  }
  if (k.length > 120) throw new ErrorNegocio("VALIDACION", "Idempotency-Key demasiado larga", 422);
  const previa = await prisma.idempotencia.findUnique({ where: { ruta_clave: { ruta, clave: k } } });
  if (previa && previa.expiraAt > new Date()) {
    return NextResponse.json({ ok: true, data: previa.respuesta }, { status: previa.status, headers: { "Idempotent-Replay": "true" } });
  }
  const r = await fn();
  await prisma.idempotencia
    .upsert({
      where: { ruta_clave: { ruta, clave: k } },
      create: { ruta, clave: k, status: r.status, respuesta: r.data as Prisma.InputJsonValue, expiraAt: new Date(Date.now() + 86_400_000) },
      update: { status: r.status, respuesta: r.data as Prisma.InputJsonValue, expiraAt: new Date(Date.now() + 86_400_000) },
    })
    .catch(() => {});
  return ok(r.data, { status: r.status });
}

// ---------------------------------------------------------------------------
// ADR-06 · Auditoría con actor: el trigger `fn_auditoria()` lee estas variables de la transacción.
// ---------------------------------------------------------------------------
export type Tx = Prisma.TransactionClient;

export async function conAuditoria<T>(
  ctx: { session?: Session | null; requestId?: string; ip?: string },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await fijarActor(tx, ctx);
    return fn(tx);
  });
}

export async function fijarActor(tx: Tx, ctx: { session?: Session | null; requestId?: string; ip?: string }) {
  const usuario = ctx.session?.sub ? String(ctx.session.sub) : "";
  await tx.$executeRaw`SELECT set_config('app.usuario_id', ${usuario}, true), set_config('app.request_id', ${ctx.requestId ?? ""}, true), set_config('app.ip', ${ctx.ip ?? ""}, true)`;
}

/** Registro explícito y legible en auditoría (además de lo que capturan los triggers). */
export async function auditar(
  ctx: { session?: Session | null; requestId?: string; ip?: string },
  datos: { localId: number | null; accion: string; entidad: string; entidadId?: string | number | null; humana?: string; datos?: unknown },
  tx: Tx | typeof prisma = prisma,
) {
  await tx.auditoria.create({
    data: {
      localId: datos.localId,
      usuarioId: ctx.session?.sub ?? null,
      accion: datos.accion,
      entidad: datos.entidad,
      entidadId: datos.entidadId == null ? null : String(datos.entidadId),
      datosJson: (datos.datos ?? undefined) as Prisma.InputJsonValue | undefined,
      ip: ctx.ip ?? null,
      requestId: ctx.requestId ?? null,
      accionHumana: datos.humana ?? null,
    },
  });
}
