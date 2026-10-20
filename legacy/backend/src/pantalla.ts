import { createHmac } from "crypto";

/** Clave firmada de la pantalla TV de un local (?k=…): permite mostrar el PIN de presencia sin sesión. */
export function claveTv(localId: number) {
  return createHmac("sha256", process.env.JWT_SECRET ?? "turnoya-dev").update(`tv:${localId}`).digest("base64url").slice(0, 22);
}
