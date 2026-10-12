"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/fetcher";

interface Item { id: number; telefono: string; texto: string; at: string; respondido: boolean }

export default function Page() {
  const [items, setItems] = useState<Item[]>([]);
  const [texto, setTexto] = useState("Hola, te atiende el local.");

  async function cargar() {
    setItems(await api<Item[]>("/api/v1/bot/bandeja"));
  }
  useEffect(() => { void cargar(); }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Bandeja de WhatsApp</h1>
      <p className="text-sm text-muted-foreground">Aparece quien escribió 0 para hablar con una persona.</p>
      {items.length === 0 && <p className="text-sm text-muted-foreground">Nadie en espera.</p>}
      {items.map((m) => (
        <article key={m.id} className="rounded-2xl border p-4 text-sm">
          <p className="font-mono">{m.telefono}</p>
          <p className="mt-1">{m.texto}</p>
          {!m.respondido && (
            <div className="mt-3 flex gap-2">
              <Input value={texto} onChange={(e) => setTexto(e.target.value)} />
              <Button onClick={async () => { await api("/api/v1/bot/bandeja", { method: "POST", json: { id: m.id, texto } }); await cargar(); }}>Responder</Button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
