import { getSession } from "@/lib/auth";
import { error, ok } from "@/lib/api";

export async function GET() {
  const session = await getSession();
  if (!session) return error("NO_AUTENTICADO", "Sin sesión", 401);
  return ok(session);
}
