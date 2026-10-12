import { NextResponse } from "next/server";
import { z } from "zod";
import { cookieOptions, login, SESSION_COOKIE } from "@/lib/auth";
import { error, ipDe, parseBody, publico, rateLimit } from "@/lib/api";
import { prisma } from "@/lib/db";

const schema = z.object({
  email: z.string().email("Correo inválido"),
  password: z.string().min(4, "Contraseña muy corta"),
});

const VENTANA_BLOQUEO_MS = 15 * 60_000;
const MAX_FALLOS = 5;

/** F7: 5 fallos seguidos por correo+IP bloquean el acceso 15 minutos. */
export const POST = publico(async (req) => {
  if (!await rateLimit(req, "login", 10)) return error("RATE_LIMIT", "Demasiados intentos. Espera un minuto.", 429);
  const body = await parseBody(req, schema);
  const clave = `login-fallo:${body.email.toLowerCase().trim()}:${ipDe(req)}`;
  const ventana = new Date(Math.floor(Date.now() / VENTANA_BLOQUEO_MS) * VENTANA_BLOQUEO_MS);
  const fallos = await prisma.rateLimit.findUnique({ where: { clave_ventana: { clave, ventana } } });
  if ((fallos?.contador ?? 0) >= MAX_FALLOS) {
    return error("CUENTA_BLOQUEADA", "Demasiados intentos fallidos. Vuelve a intentarlo en 15 minutos.", 429);
  }
  const r = await login(body.email, body.password);
  if (!r) {
    await prisma.rateLimit.upsert({
      where: { clave_ventana: { clave, ventana } },
      create: { clave, ventana, contador: 1 },
      update: { contador: { increment: 1 } },
    });
    return error("CREDENCIALES_INVALIDAS", "Correo o contraseña incorrectos", 401);
  }
  await prisma.rateLimit.deleteMany({ where: { clave } });

  const res = NextResponse.json({ ok: true, data: r.session });
  res.cookies.set(SESSION_COOKIE, r.token, cookieOptions());
  return res;
});
