"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { backoffMs, codigoProvisional, mejorOffset, muestraReloj, siguienteConexion, uuidv7, type EstadoConexion, type MuestraReloj } from "@/lib/kiosco/reglas";
import { actualizar, cifrarTexto, descifrarTexto, encolar, escribirMeta, leerMeta, pendientes, quitar, type EventoLocal } from "@/lib/kiosco/almacen";

/**
 * M5 · App del kiosco (offline-first). Pantallas K0 inicio · K1 servicio · K1b tipo de atención · K3 ticket · K9 mantenimiento.
 * Cada pulsación de "Imprimir" se guarda primero en IndexedDB (con su clave de idempotencia) y recién después se intenta la red.
 */

const VERSION_APP = "kiosco-2.0";
interface Config {
  version: number;
  dispositivo: { id: number; numero: number; nombre: string };
  local: { nombre: string; color: string; logoUrl: string | null; slug: string };
  colas: { id: number; nombre: string; prefijo: string; descripcion: string | null }[];
  categorias: { codigo: string; nombre: string }[];
  citas: boolean;
  abierto: boolean;
  mensajeCerrado: string | null;
  inactividadSeg: number;
  textos: { consentimiento: string };
}
type Pantalla = "inicio" | "servicio" | "tipo" | "ticket" | "cita" | "mantenimiento";
interface Ticket { codigo: string; provisional: boolean; url: string; cola: string }

const hoyLima = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());

export default function Kiosco() {
  const [token, setToken] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  const [pantalla, setPantalla] = useState<Pantalla>("inicio");
  const [cola, setCola] = useState<Config["colas"][number] | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [conexion, setConexion] = useState<EstadoConexion>("ONLINE");
  const [nPend, setNPend] = useState(0);
  const [codigoPar, setCodigoPar] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [revocado, setRevocado] = useState(false);
  const [codigoCita, setCodigoCita] = useState("");
  const [pin, setPin] = useState("");
  const [toques, setToques] = useState(0);
  const offset = useRef(0);
  const muestras = useRef<MuestraReloj[]>([]);
  const fallos = useRef({ n: 0, desde: 0 });
  const ultimaActividad = useRef(0);
  const [offsetMs, setOffsetMs] = useState(0);
  // La sincronización se invoca desde efectos y desde el service worker: se guarda la última versión en una ref
  const syncRef = useRef<() => Promise<void>>(async () => {});

  // --- Arranque: token cifrado en IndexedDB, almacenamiento persistente, SW con alcance /kiosco
  useEffect(() => {
    (async () => {
      const t = await leerMeta<{ iv: number[]; datos: number[] }>("token");
      if (t) setToken(await descifrarTexto(t).catch(() => null));
      const c = await leerMeta<Config>("config");
      if (c) setConfig(c);
      setListo(true);
      void navigator.storage?.persist?.();
      if ("serviceWorker" in navigator) {
        void navigator.serviceWorker.register("/kiosco/sw.js", { scope: "/kiosco" }).catch(() => {});
        navigator.serviceWorker.addEventListener("message", (e) => e.data?.tipo === "sync" && void syncRef.current());
      }
      ultimaActividad.current = Date.now();
    })();
  }, []);

  const llamar = useCallback(async <T,>(url: string, json?: unknown, timeoutMs = 4000): Promise<T> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: json === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: json === undefined ? undefined : JSON.stringify(json), signal: ctrl.signal, cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: T; error?: { codigo: string; mensaje: string } };
      if (res.status === 401) {
        setRevocado(true);
        throw new Error("Dispositivo no autorizado");
      }
      if (!res.ok || !body.ok) throw Object.assign(new Error(body.error?.mensaje ?? `HTTP ${res.status}`), { codigo: body.error?.codigo, red: res.status >= 500 });
      return body.data as T;
    } finally {
      clearTimeout(t);
    }
  }, [token]);

  const registrarFallo = useCallback(() => {
    const f = fallos.current;
    if (!f.n) f.desde = Date.now();
    f.n++;
    setConexion((e) => siguienteConexion(e, { tipo: "FALLO", fallosSeguidos: f.n, desdePrimerFalloMs: Date.now() - f.desde }));
  }, []);

  // --- Sincronización por lotes (candado entre pestañas con navigator.locks)
  async function sincronizar() {
    if (!token) return;
    const correr = async () => {
      const todos = await pendientes();
      setNPend(todos.length);
      const lote = todos.filter((e) => e.proximoIntentoAt <= Date.now()).slice(0, 100);
      if (!lote.length) return;
      try {
        const eventos = await Promise.all(lote.map(async (e) => ({ claveIdem: e.claveIdem, seq: e.seq, tipo: e.tipo, tsDispositivo: e.tsDispositivo, offsetMsAlEmitir: e.offsetMsAlEmitir, payload: JSON.parse(await descifrarTexto(e.payloadCifrado)) })));
        const r = await llamar<{ resultados: { claveIdem: string }[] }>("/api/v1/kiosco/sync", { eventos }, 15000);
        await quitar(r.resultados.map((x) => x.claveIdem));
      } catch {
        for (const e of lote) await actualizar({ ...e, intentos: e.intentos + 1, proximoIntentoAt: Date.now() + backoffMs(e.intentos + 1) });
      }
      setNPend((await pendientes()).length);
    };
    if (navigator.locks) await navigator.locks.request("turnoya-kiosco-sync", { ifAvailable: true }, async (l) => (l ? correr() : undefined));
    else await correr();
  }
  useEffect(() => {
    syncRef.current = sincronizar;
  });

  // --- Heartbeat cada 20 s: estima el desfase de reloj (muestra de menor RTT) y la configuración
  useEffect(() => {
    if (!token) return;
    const latido = async () => {
      const t0 = Date.now();
      try {
        const r = await llamar<{ serverTime: string; configVersion: number }>("/api/v1/kiosco/heartbeat", { estado: conexion, pendientes: nPend, version: VERSION_APP, offsetMs: offset.current }, 4000);
        const t1 = Date.now();
        muestras.current = [...muestras.current, muestraReloj(t0, t1, Date.parse(r.serverTime))].slice(-5);
        offset.current = mejorOffset(muestras.current);
        setOffsetMs(offset.current);
        fallos.current = { n: 0, desde: 0 };
        const p = (await pendientes()).length;
        setConexion((e) => siguienteConexion(e, { tipo: "OK", rtt: t1 - t0, pendientes: p }));
        if (!config || r.configVersion !== config.version || !config.colas) {
          const c = await llamar<Config>("/api/v1/kiosco/config");
          setConfig(c);
          await escribirMeta("config", c);
        }
        if (p) void syncRef.current();
      } catch (e) {
        if (!(e instanceof Error && e.message.includes("autorizado"))) registrarFallo();
      }
    };
    void latido();
    const t = setInterval(latido, 20_000);
    const on = () => void latido();
    window.addEventListener("online", on);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", on);
    };
  }, [token, llamar, registrarFallo, conexion, nPend, config]);

  // --- Inactividad: vuelve al inicio a los 30 s (RF-M5-09)
  useEffect(() => {
    const marcar = () => (ultimaActividad.current = Date.now());
    window.addEventListener("pointerdown", marcar);
    const t = setInterval(() => {
      if (pantalla !== "inicio" && pantalla !== "mantenimiento" && Date.now() - ultimaActividad.current > (config?.inactividadSeg ?? 30) * 1000) {
        setPantalla("inicio");
        setTicket(null);
      }
    }, 1000);
    return () => {
      window.removeEventListener("pointerdown", marcar);
      clearInterval(t);
    };
  }, [pantalla, config]);

  async function emparejar() {
    setError(null);
    try {
      const res = await fetch("/api/v1/kiosco/emparejar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codigo: codigoPar }) });
      const b = (await res.json()) as { ok: boolean; data?: { token: string; config: Config }; error?: { mensaje: string } };
      if (!b.ok || !b.data) throw new Error(b.error?.mensaje ?? "Código inválido");
      await escribirMeta("token", await cifrarTexto(b.data.token));
      await escribirMeta("config", b.data.config);
      setConfig(b.data.config);
      setToken(b.data.token);
      setRevocado(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo emparejar");
    }
  }

  /** §6.2: clave → IndexedDB → red; si falla, ticket provisional con la MISMA clave. */
  async function imprimir(categoria: string | null) {
    if (!config || !cola) return;
    const fecha = hoyLima();
    const ahora = Date.now();
    const ev = await encolar(fecha, (seq) => ({
      claveIdem: uuidv7(ahora),
      seq,
      tipo: "EMITIR_TURNO",
      tsDispositivo: new Date(ahora).toISOString(),
      offsetMsAlEmitir: offset.current,
      payloadCifrado: { iv: [], datos: [] },
      intentos: 0,
      proximoIntentoAt: ahora,
      codigoProvisional: codigoProvisional(config.dispositivo.numero, seq),
    }));
    const payload = { colaId: cola.id, categoria };
    await actualizar({ ...ev, payloadCifrado: await cifrarTexto(JSON.stringify(payload)) } as EventoLocal);
    try {
      if (conexion === "OFFLINE") throw new Error("offline");
      const r = await llamar<{ estado: string; turno?: { codigo: string; token: string } }>("/api/v1/kiosco/turnos", { claveIdem: ev.claveIdem, seq: ev.seq, tsDispositivo: ev.tsDispositivo, offsetMsAlEmitir: ev.offsetMsAlEmitir, ...payload });
      await quitar([ev.claveIdem]);
      if (r.turno) setTicket({ codigo: r.turno.codigo, provisional: false, url: `${location.origin}/t/${r.turno.token}`, cola: cola.nombre });
      else setTicket({ codigo: ev.codigoProvisional, provisional: true, url: `${location.origin}/k/${config.dispositivo.id}/${fecha}/${ev.seq}`, cola: cola.nombre });
    } catch {
      registrarFallo();
      setTicket({ codigo: ev.codigoProvisional, provisional: true, url: `${location.origin}/k/${config.dispositivo.id}/${fecha}/${ev.seq}`, cola: cola.nombre });
      setNPend((await pendientes()).length);
      void (navigator.serviceWorker?.ready as Promise<ServiceWorkerRegistration & { sync?: { register(t: string): Promise<void> } }> | undefined)?.then((r) => r.sync?.register("kiosco-sync")).catch(() => {});
    }
    setPantalla("ticket");
    setTimeout(() => window.print(), 300);
  }

  async function checkinCita() {
    setError(null);
    try {
      const r = await llamar<{ codigo: string; turnoToken: string }>("/api/v1/kiosco/citas/checkin", { codigo: codigoCita });
      setTicket({ codigo: r.codigo, provisional: false, url: `${location.origin}/t/${r.turnoToken}`, cola: "Cita" });
      setPantalla("ticket");
      setTimeout(() => window.print(), 300);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo hacer el check-in");
    }
  }

  const color = config?.local.color ?? "#0f766e";
  const boton = "min-h-16 rounded-3xl px-6 text-2xl font-semibold text-white shadow-lg active:scale-[0.98]";

  if (!listo) return null;
  if (revocado || !token) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 p-8 text-center">
        <h1 className="text-3xl font-bold">{revocado ? "Dispositivo no autorizado" : "Emparejar kiosco"}</h1>
        <p className="text-lg text-muted-foreground">Ingresa el código de 6 dígitos generado en Admin → Kiosco.</p>
        <input inputMode="numeric" maxLength={6} aria-label="Código de emparejamiento" value={codigoPar} onChange={(e) => setCodigoPar(e.target.value.replace(/\D/g, ""))} className="h-20 rounded-2xl border text-center font-mono text-4xl tracking-[0.4em]" />
        {error && <p role="alert" className="text-rose-700">{error}</p>}
        <button type="button" className={boton} style={{ background: color }} disabled={codigoPar.length !== 6} onClick={emparejar}>Emparejar</button>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen select-none flex-col bg-white" onContextMenu={(e) => e.preventDefault()}>
      <style>{`@media print { body * { visibility: hidden } #ticket, #ticket * { visibility: visible } #ticket { position: absolute; left: 0; top: 0; width: 72mm } @page { size: 80mm auto; margin: 0 } }`}</style>
      {conexion === "OFFLINE" && <p role="status" className="bg-amber-300 p-3 text-center text-lg font-medium text-amber-950">Sin conexión: tu ticket es provisional; tu número definitivo aparecerá en la pantalla.</p>}
      <header className="flex items-center justify-between px-8 py-5" style={{ background: color }}>
        <button type="button" className="text-left text-2xl font-bold text-white" onClick={() => { setToques((t) => t + 1); if (toques + 1 >= 5) { setToques(0); setPantalla("mantenimiento"); } }}>{config?.local.nombre ?? "TurnoYa"}</button>
        <span className="text-sm text-white/80" aria-label="Estado de conexión">{conexion === "ONLINE" ? "●" : conexion === "OFFLINE" ? "○" : "◐"}{nPend ? ` · ${nPend} pendientes` : ""}</span>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
        {pantalla === "inicio" && (
          <>
            {config && !config.abierto && <p className="text-2xl text-muted-foreground">{config.mensajeCerrado}</p>}
            <button type="button" className={`${boton} h-48 w-full max-w-xl text-4xl`} style={{ background: color }} onClick={() => setPantalla("servicio")}>Toque para sacar turno</button>
            {config?.citas && <button type="button" className="min-h-16 rounded-3xl border-2 px-8 text-2xl" onClick={() => setPantalla("cita")}>Tengo una cita</button>}
          </>
        )}

        {pantalla === "servicio" && (
          <div className="grid w-full max-w-2xl gap-4">
            <h1 className="text-center text-3xl font-bold">Elige el servicio</h1>
            {config?.colas.map((c) => (
              <button key={c.id} type="button" className="min-h-24 rounded-3xl border-2 p-5 text-left text-3xl font-semibold active:bg-muted" onClick={() => { setCola(c); if (config.categorias.length) setPantalla("tipo"); else void imprimir(null); }}>
                {c.nombre}{c.descripcion && <span className="block text-lg font-normal text-muted-foreground">{c.descripcion}</span>}
              </button>
            ))}
            <button type="button" className="mt-2 text-xl underline" onClick={() => setPantalla("inicio")}>Volver</button>
          </div>
        )}

        {pantalla === "tipo" && (
          <div className="grid w-full max-w-2xl gap-4">
            <h1 className="text-center text-3xl font-bold">Tipo de atención</h1>
            <button type="button" className="min-h-20 rounded-3xl border-2 text-2xl" onClick={() => imprimir(null)}>General</button>
            {config?.categorias.map((c) => <button key={c.codigo} type="button" className="min-h-20 rounded-3xl border-2 text-2xl" onClick={() => imprimir(c.codigo)}>{c.nombre}</button>)}
            <p className="text-center text-lg text-muted-foreground">La atención preferente se verifica en ventanilla.</p>
          </div>
        )}

        {pantalla === "cita" && (
          <div className="grid w-full max-w-md gap-4 text-center">
            <h1 className="text-3xl font-bold">Check-in de cita</h1>
            <input aria-label="Código de la cita" maxLength={6} value={codigoCita} onChange={(e) => setCodigoCita(e.target.value.toUpperCase())} className="h-20 rounded-2xl border text-center font-mono text-4xl tracking-[0.3em]" />
            {error && <p role="alert" className="text-lg text-rose-700">{error}</p>}
            <button type="button" className={boton} style={{ background: color }} onClick={checkinCita} disabled={codigoCita.length < 6}>Confirmar llegada</button>
            <button type="button" className="text-xl underline" onClick={() => setPantalla("inicio")}>Volver</button>
          </div>
        )}

        {pantalla === "ticket" && ticket && (
          <div id="ticket" className="flex flex-col items-center gap-3 text-center">
            <p className="text-2xl">{ticket.cola}</p>
            <p className="font-mono text-8xl font-bold" style={{ color }}>{ticket.codigo}</p>
            {ticket.provisional && <p className="max-w-sm text-lg text-amber-800">Ticket provisional: tu número definitivo aparecerá en la pantalla. Conserva este papel.</p>}
            <QRCodeSVG value={ticket.url} size={180} />
            <p className="text-lg">Escanea para seguir tu turno</p>
            <button type="button" className="mt-4 text-xl underline print:hidden" onClick={() => { setPantalla("inicio"); setTicket(null); }}>Listo</button>
          </div>
        )}

        {pantalla === "mantenimiento" && (
          <div className="grid w-full max-w-md gap-3 text-center">
            <h1 className="text-2xl font-bold">Mantenimiento</h1>
            <input inputMode="numeric" aria-label="PIN" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className="h-14 rounded-xl border text-center font-mono text-2xl" />
            <button type="button" className="rounded-xl border p-3" onClick={async () => {
              const r = await llamar<{ valido: boolean }>("/api/v1/kiosco/mantenimiento", { pin }).catch(() => ({ valido: false }));
              setError(r.valido ? "PIN correcto" : "PIN incorrecto");
            }}>Validar PIN</button>
            {error === "PIN correcto" && (
              <>
                <p>Pendientes: {nPend} · desfase {Math.round(offsetMs / 1000)} s · {VERSION_APP}</p>
                <button type="button" className="rounded-xl border p-3" onClick={() => void sincronizar()}>Forzar sincronización</button>
                <button type="button" className="rounded-xl border p-3" onClick={() => window.print()}>Reimprimir último</button>
                <button type="button" className="rounded-xl border p-3 text-rose-700" onClick={async () => { await escribirMeta("token", undefined); setToken(null); }}>Desemparejar</button>
              </>
            )}
            {error && error !== "PIN correcto" && <p className="text-rose-700">{error}</p>}
            <button type="button" className="underline" onClick={() => { setPantalla("inicio"); setError(null); setPin(""); }}>Salir</button>
          </div>
        )}
      </section>
    </main>
  );
}
