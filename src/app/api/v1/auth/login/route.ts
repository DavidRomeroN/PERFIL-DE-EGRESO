import { NextResponse } from "next/server";
import { z } from "zod";
import { cookieOptions, login, SESSION_COOKIE } from "@/lib/auth";
import { error, parseBody, publico, rateLimit } from "@/lib/api";

const schema = z.object({
  email: z.string().email("Correo inválido"),
  password: z.string().min(4, "Contraseña muy corta"),
});

export const POST = publico(async (req) => {
  if (!rateLimit(req, "login", 10)) return error("RATE_LIMIT", "Demasiados intentos. Espera un minuto.", 429);
  const body = await parseBody(req, schema);
  const r = await login(body.email, body.password);
  if (!r) return error("CREDENCIALES_INVALIDAS", "Correo o contraseña incorrectos", 401);

  const res = NextResponse.json({ ok: true, data: r.session });
  res.cookies.set(SESSION_COOKIE, r.token, cookieOptions());
  return res;
});
