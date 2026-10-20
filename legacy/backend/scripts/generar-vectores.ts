/**
 * Vectores dorados de compatibilidad Node → Java (riesgo 3 del plan de migración).
 *
 * Genera con el código REAL de legacy/ valores que el backend Java debe reproducir exactamente: normalización y hash
 * de celulares, máscara, descifrado de teléfonos guardados, hashes bcrypt y sesiones JWT. Si alguien cambia una de
 * estas reglas en un lado y no en el otro, las pruebas de backend/ fallan.
 *
 *   cd legacy/backend && npx tsx scripts/generar-vectores.ts
 * Escribe backend/src/test/resources/vectores/compatibilidad.json (en la raíz del repositorio).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";

const CLAVE_HEX = "3f1c9a7b5e2d4c6a8b0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e";
const CLAVE_TEXTO = "clave-de-pruebas-turnoya-0123456789abcdef";
const JWT_SECRET = "secreto-de-pruebas-turnoya-0123456789abcdef";

async function main() {
  // auth.ts importa el cliente de Prisma: basta una URL cualquiera, el script no se conecta a la BD
  process.env.DATABASE_URL ??= "postgresql://vectores:vectores@127.0.0.1:1/vectores";
  const salida: Record<string, unknown> = {};

  // Celulares: normalización, hash y máscara (no dependen de claves)
  const crypto = await import("../src/crypto");
  const entradas = ["951234567", "951 234 567", "+51 951-234-567", "51951234567", "0051951234567", "12345", "", "abc", "987654321", "+1 415 555 0101"];
  salida.telefonos = entradas.map((entrada) => {
    const e164 = crypto.normalizarTelefono(entrada);
    return { entrada, e164, hash: e164 ? crypto.hashTelefono(e164) : null, mascara: e164 ? crypto.enmascararTelefono(e164) : null };
  });

  // Cifrado: textos cifrados por Node con cada forma de clave (hex de 64 o texto que se deriva con SHA-256)
  const textos = ["+51951234567", "+51987654321", "Ñandú — prueba UTF-8 ✓"];
  salida.cifrado = [];
  for (const clave of [CLAVE_HEX, CLAVE_TEXTO]) {
    process.env.DATA_ENCRYPTION_KEY = clave;
    for (const texto of textos) {
      (salida.cifrado as unknown[]).push({ clave, texto, cifrado: crypto.cifrar(texto) });
    }
  }

  // bcrypt ($2b$ de bcryptjs): Java debe validar estas contraseñas sin resetearlas
  salida.bcrypt = [
    { clave: "admin123", hash: bcrypt.hashSync("admin123", 10) },
    { clave: "operador123", hash: bcrypt.hashSync("operador123", 10) },
  ];

  // Sesión JWT firmada por legacy/
  process.env.JWT_SECRET = JWT_SECRET;
  const auth = await import("../src/auth");
  const sesiones = [
    { sub: 7, email: "operador@policlinico.pe", nombre: "Operador Demo", rol: "OPERADOR", localId: 1, localSlug: "policlinico", localNombre: "Policlínico" },
    { sub: 1, email: "superadmin@turnoya.pe", nombre: "Super Admin", rol: "SUPER_ADMIN", localId: null, localSlug: null, localNombre: null },
  ] as const;
  salida.jwt = { secreto: JWT_SECRET, sesiones: [] as unknown[] };
  for (const s of sesiones) {
    const emitidoMs = Date.now();
    const token = await auth.firmarSesion({ ...s });
    (salida.jwt as { sesiones: unknown[] }).sesiones.push({ token, emitidoMs, sesion: s });
  }

  const destino = path.resolve(process.cwd(), "../../backend/src/test/resources/vectores/compatibilidad.json");
  mkdirSync(path.dirname(destino), { recursive: true });
  writeFileSync(destino, JSON.stringify(salida, null, 2) + "\n");
  console.log(`Vectores escritos en ${destino}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
