"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/fetcher";

interface Pendiente { id: string; colaId: number; nombre: string }

export default function Page() {
  const [colas, setColas] = useState<{ id: number; nombre: string }[]>([]);
  const [colaId, setColaId] = useState(0);
  const [nombre, setNombre] = useState("");
  const [outbox, setOutbox] = useState<Pendiente[]>([]);
  const [codigo, setCodigo] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [codigoLocal, setCodigoLocal] = useState("");
  const [emparejado, setEmparejado] = useState(false);

  useEffect(() => {
    const guardado = localStorage.getItem("turnoya-kiosco");
    if (guardado) {
      try {
        const parsed = JSON.parse(guardado) as Pendiente[] | { data: number[] };
        if (Array.isArray(parsed)) setOutbox(parsed);
      } catch { /* cola cifrada de otro código */ }
    }
    api<{ colas: { id: number; nombre: string }[] }>("/api/v1/public/locales/policlinico-san-roman")
      .then((d) => { setColas(d.colas); setColaId(d.colas[0]?.id ?? 0); })
      .catch(() => setOffline(true));
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => {});
    const on = () => setOffline(!navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", on); };
  }, []);

  async function guardar(lista: Pendiente[]) {
    setOutbox(lista);
    const plano = JSON.stringify(lista);
    if (!codigoLocal) {
      localStorage.setItem("turnoya-kiosco", plano);
      return;
    }
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(codigoLocal.padEnd(32, "0").slice(0, 32)), "AES-GCM", false, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cifrado = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plano));
    localStorage.setItem("turnoya-kiosco", JSON.stringify({ iv: [...iv], data: [...new Uint8Array(cifrado)] }));
  }

  async function tomar() {
    const item = { id: crypto.randomUUID(), colaId, nombre };
    if (!navigator.onLine) {
      guardar([...outbox, item]);
      setCodigo("Pendiente de sincronizar");
      return;
    }
    const turno = await api<{ codigo: string }>("/api/v1/kiosco/turnos", { method: "POST", json: item });
    setCodigo(turno.codigo);
  }

  async function sincronizar() {
    const restantes: Pendiente[] = [];
    for (const item of outbox) {
      try {
        await api("/api/v1/kiosco/turnos", { method: "POST", json: item });
      } catch {
        restantes.push(item);
      }
    }
    guardar(restantes);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 px-6">
      <h1 className="text-3xl font-semibold">Kiosco TurnoYa</h1>
      {!emparejado && (
        <div className="flex gap-2">
          <input className="h-12 flex-1 rounded-xl border px-3" placeholder="Código del local" value={codigoLocal} onChange={(e) => setCodigoLocal(e.target.value)} />
          <Button onClick={async () => {
            await api("/api/v1/kiosco/emparejar", { method: "PUT", json: { codigo: codigoLocal } });
            setEmparejado(true);
          }}>Vincular</Button>
        </div>
      )}
      <p className="text-sm text-muted-foreground">{offline ? "Sin conexión: el turno se guarda en este equipo." : "En línea"} · {outbox.length} por sincronizar</p>
      <select className="h-12 rounded-xl border px-3" value={colaId} onChange={(e) => setColaId(Number(e.target.value))}>
        {colas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </select>
      <input className="h-12 rounded-xl border px-3" placeholder="Nombre (opcional)" value={nombre} onChange={(e) => setNombre(e.target.value)} />
      <Button className="h-14 text-lg" onClick={() => void tomar()}>Tomar turno</Button>
      {outbox.length > 0 && <Button variant="outline" onClick={() => void sincronizar()}>Sincronizar</Button>}
      {codigo && <p className="text-center font-mono text-5xl font-bold">{codigo}</p>}
    </main>
  );
}
