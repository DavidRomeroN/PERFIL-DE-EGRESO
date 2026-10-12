/** M4 · Normalización de texto y detección de intención (docs/modulos/M4-chatbot-whatsapp.md §6.3). Funciones puras. */

export type TipoSimple = "MENU" | "AYUDA" | "SALIR" | "ATRAS" | "TOMAR_TURNO" | "POSICION" | "CANCELAR" | "HORARIOS" | "CITA" | "HUMANO" | "SI" | "NO" | "OMITIR" | "OTRO";
export type Intencion = { tipo: "NUMERO"; n: number } | { tipo: TipoSimple };

const EMOJI_SI = /[👍✅👌🙆]/u;
const EMOJI_NO = /[👎❌🙅]/u;

export function normalizar(s: string) {
  return s
    .slice(0, 1000)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const GLOBALES: Record<string, TipoSimple> = {
  menu: "MENU", inicio: "MENU", hola: "MENU", buenas: "MENU", buenos: "MENU", "buenas tardes": "MENU", "buenos dias": "MENU",
  ayuda: "AYUDA", salir: "SALIR", chau: "SALIR", adios: "SALIR", atras: "ATRAS", volver: "ATRAS",
  omitir: "OMITIR", "-": "OMITIR",
};

const SINONIMOS: [TipoSimple, string[]][] = [
  ["POSICION", ["posicion", "cuanto falta", "mi turno", "cuando", "falta"]],
  ["TOMAR_TURNO", ["turno", "sacar", "tomar", "ticket", "numero"]],
  ["CANCELAR", ["cancelar", "anular", "ya no"]],
  ["HORARIOS", ["horario", "horarios", "atienden", "abren", "hora"]],
  ["CITA", ["cita", "agendar", "reservar", "reserva"]],
  ["HUMANO", ["asesor", "persona", "humano", "operador", "agente"]],
  ["SI", ["si", "sii", "ok", "claro", "confirmo", "acepto", "dale", "ya"]],
  ["NO", ["no", "nop", "nel", "negativo"]],
];

function coincide(palabras: string[], frase: string, norm: string) {
  if (frase.includes(" ")) return norm.includes(frase);
  return palabras.some((p) => p === frase || (frase.length >= 5 && p.length >= 4 && levenshtein(p, frase) <= 1));
}

export function intencion(texto: string): Intencion {
  if (EMOJI_SI.test(texto)) return { tipo: "SI" };
  if (EMOJI_NO.test(texto)) return { tipo: "NO" };
  if (texto.trim() === "-") return { tipo: "OMITIR" };
  const norm = normalizar(texto);
  if (!norm) return { tipo: "OTRO" };
  if (/^\d{1,2}$/.test(norm)) return { tipo: "NUMERO", n: Number(norm) };
  if (GLOBALES[norm]) return { tipo: GLOBALES[norm] };
  const palabras = norm.split(" ");
  // "si"/"no" solo cuentan como respuesta si son toda la frase o la primera palabra
  for (const [tipo, frases] of SINONIMOS) {
    if (tipo === "SI" || tipo === "NO") {
      if (frases.includes(palabras[0]) && palabras.length <= 3) return { tipo };
      continue;
    }
    if (frases.some((f) => coincide(palabras, f, norm))) return { tipo };
  }
  return { tipo: "OTRO" };
}
