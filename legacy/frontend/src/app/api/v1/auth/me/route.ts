import { getSession } from "@backend/auth";
import { error, ok } from "@backend/api";

export async function GET() {
  const session = await getSession();
  if (!session) return error("NO_AUTENTICADO", "Sin sesión", 401);
  return ok(session);
}
