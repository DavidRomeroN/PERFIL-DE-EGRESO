/**
 * M5 · Almacén local del kiosco (IndexedDB) — solo navegador.
 * `meta` (token, secuencia por día, desfase de reloj) y `outbox` (eventos pendientes).
 * El token y los datos personales se cifran con una CryptoKey AES-GCM **no extraíble** guardada en IndexedDB (RN-M5-08).
 */

const DB = "turnoya-kiosco";
const VERSION = 1;

function abrir(): Promise<IDBDatabase> {
  return new Promise((ok, mal) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "claveIdem" });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((ok, mal) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
}

export async function leerMeta<T>(clave: string): Promise<T | undefined> {
  const db = await abrir();
  return req(db.transaction("meta").objectStore("meta").get(clave)) as Promise<T | undefined>;
}

export async function escribirMeta(clave: string, valor: unknown) {
  const db = await abrir();
  await req(db.transaction("meta", "readwrite").objectStore("meta").put(valor, clave));
}

/** Clave de cifrado no extraíble (se crea una vez por dispositivo). */
export async function claveCifrado(): Promise<CryptoKey> {
  const k = await leerMeta<CryptoKey>("clave");
  if (k) return k;
  const nueva = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await escribirMeta("clave", nueva);
  return nueva;
}

export async function cifrarTexto(t: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await claveCifrado(), new TextEncoder().encode(t));
  return { iv: Array.from(iv), datos: Array.from(new Uint8Array(c)) };
}

export async function descifrarTexto(x: { iv: number[]; datos: number[] }) {
  const p = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(x.iv) }, await claveCifrado(), new Uint8Array(x.datos));
  return new TextDecoder().decode(p);
}

export interface EventoLocal {
  claveIdem: string;
  seq: number;
  tipo: "EMITIR_TURNO" | "CHECKIN_CITA";
  tsDispositivo: string;
  offsetMsAlEmitir: number;
  payloadCifrado: { iv: number[]; datos: number[] };
  intentos: number;
  proximoIntentoAt: number;
  codigoProvisional: string;
}

/**
 * RN-M5-02: asignar el `seq` del día y guardar el evento en **una sola transacción** de IndexedDB,
 * antes de cualquier llamada de red: aunque se corte la luz, el turno no se pierde.
 */
export async function encolar(fechaISO: string, armar: (seq: number) => EventoLocal): Promise<EventoLocal> {
  const db = await abrir();
  return new Promise((ok, mal) => {
    const tx = db.transaction(["meta", "outbox"], "readwrite");
    const meta = tx.objectStore("meta");
    const g = meta.get("seq");
    let ev: EventoLocal;
    g.onsuccess = () => {
      const s = (g.result as Record<string, number> | undefined) ?? {};
      const seq = (s[fechaISO] ?? 0) + 1;
      meta.put({ [fechaISO]: seq }, "seq");
      ev = armar(seq);
      tx.objectStore("outbox").put(ev);
    };
    tx.oncomplete = () => ok(ev);
    tx.onerror = () => mal(tx.error);
  });
}

export async function pendientes(): Promise<EventoLocal[]> {
  const db = await abrir();
  const xs = (await req(db.transaction("outbox").objectStore("outbox").getAll())) as EventoLocal[];
  return xs.sort((a, b) => a.seq - b.seq);
}

export async function quitar(claves: string[]) {
  const db = await abrir();
  const tx = db.transaction("outbox", "readwrite");
  for (const k of claves) tx.objectStore("outbox").delete(k);
  await new Promise((ok) => (tx.oncomplete = ok));
}

export async function actualizar(ev: EventoLocal) {
  const db = await abrir();
  await req(db.transaction("outbox", "readwrite").objectStore("outbox").put(ev));
}
