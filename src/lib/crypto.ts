import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * Utilidades de protección de datos personales (Ley N.° 29733).
 * El teléfono se guarda cifrado (AES-256-GCM) y con un hash para búsquedas.
 */

function getKey(): Buffer {
  const raw = process.env.DATA_ENCRYPTION_KEY ?? "0123456789abcdef0123456789abcdef";
  // Acepta 64 hex chars o cualquier texto -> se deriva con SHA-256
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  return createHash("sha256").update(raw).digest();
}

/** Normaliza un celular peruano a formato E.164 (+51XXXXXXXXX). */
export function normalizarTelefono(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 9 && digits.startsWith("9")) return `+51${digits}`;
  if (digits.length === 11 && digits.startsWith("51")) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return null;
}

export function hashTelefono(telefonoE164: string): string {
  return createHash("sha256").update(telefonoE164).digest("hex");
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function descifrar(payload: string): string | null {
  try {
    const [ivB64, tagB64, encB64] = payload.split(".");
    const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const dec = Buffer.concat([decipher.update(Buffer.from(encB64, "base64")), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return null;
  }
}

/** +51987654321 -> +51 9** *** 321 */
export function enmascararTelefono(telefonoE164: string): string {
  const d = telefonoE164.replace(/\D/g, "");
  if (d.length < 7) return "***";
  const pais = d.slice(0, d.length - 9);
  const num = d.slice(-9);
  return `+${pais} ${num[0]}** *** ${num.slice(-3)}`;
}

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generarToken(longitud = 10): string {
  const bytes = randomBytes(longitud);
  let out = "";
  for (let i = 0; i < longitud; i++) out += ALFABETO[bytes[i] % ALFABETO.length];
  return out;
}
