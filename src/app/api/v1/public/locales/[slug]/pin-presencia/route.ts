import { error, ok, paramsDe, publico } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { moduloActivo } from "@/lib/modulos";
import { pinActual } from "@/lib/citas/service";
import { claveTv } from "@/lib/pantalla";

/**
 * GET /api/v1/public/locales/:slug/pin-presencia — PIN vigente para la TV/panel (M3).
 * No es público: exige la clave de pantalla (?k=, enlace firmado desde el admin) o una sesión del mismo local.
 */
export const GET = publico<{ params: Promise<{ slug: string }> }>(async (req, ctx) => {
  const { slug } = await paramsDe(ctx);
  const local = await prisma.local.findUnique({ where: { slug } });
  if (!local) return error("LOCAL_NO_ENCONTRADO", "El local no existe", 404);
  const k = new URL(req.url).searchParams.get("k");
  const session = await getSession();
  const autorizado = (k && k === claveTv(local.id)) || (session && (session.rol === "SUPER_ADMIN" || session.localId === local.id));
  if (!autorizado) return error("PROHIBIDO", "Enlace de pantalla inválido", 403);
  if (!(await moduloActivo(local.id, "M3"))) return ok(null);
  return ok(pinActual(local.id));
});
