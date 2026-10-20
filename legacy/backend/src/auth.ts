import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "@backend/db";
import type { RolUsuario } from "@backend/generated/prisma/client";

export const SESSION_COOKIE = "turnoya_session";
const SESSION_HOURS = 12;

export interface Session {
  sub: number;
  email: string;
  nombre: string;
  rol: RolUsuario;
  localId: number | null;
  localSlug: string | null;
  localNombre: string | null;
}

function secret() {
  const s = process.env.JWT_SECRET ?? "turnoya-dev-secret-cambiar-en-produccion-2026";
  return new TextEncoder().encode(s);
}

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export async function firmarSesion(session: Session): Promise<string> {
  const { sub, ...resto } = session;
  return new SignJWT({ ...resto })
    .setSubject(String(sub))
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret());
}

export async function verificarSesion(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return {
      sub: Number(payload.sub),
      email: String(payload.email),
      nombre: String(payload.nombre),
      rol: payload.rol as RolUsuario,
      localId: (payload.localId as number | null) ?? null,
      localSlug: (payload.localSlug as string | null) ?? null,
      localNombre: (payload.localNombre as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verificarSesion(token);
}

export async function login(email: string, password: string) {
  const usuario = await prisma.usuario.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: { local: { select: { id: true, slug: true, nombreComercial: true, activo: true } } },
  });
  if (!usuario || !usuario.activo) return null;
  if (usuario.local && !usuario.local.activo) return null;
  const ok = await verifyPassword(password, usuario.hashPassword);
  if (!ok) return null;

  await prisma.usuario.update({ where: { id: usuario.id }, data: { ultimoAcceso: new Date() } });

  const session: Session = {
    sub: usuario.id,
    email: usuario.email,
    nombre: usuario.nombre,
    rol: usuario.rol,
    localId: usuario.localId,
    localSlug: usuario.local?.slug ?? null,
    localNombre: usuario.local?.nombreComercial ?? null,
  };
  const token = await firmarSesion(session);
  return { session, token };
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_APP_URL?.startsWith("https"),
    path: "/",
    maxAge: SESSION_HOURS * 60 * 60,
  };
}

export function puede(session: Session | null, roles: RolUsuario[]): session is Session {
  return !!session && roles.includes(session.rol);
}

/** Devuelve el local sobre el que actúa el usuario (admins/operadores: su local; super-admin: el indicado). */
export function resolverLocalId(session: Session, solicitado?: number | null): number | null {
  if (session.rol === "SUPER_ADMIN") return solicitado ?? session.localId ?? null;
  return session.localId;
}
