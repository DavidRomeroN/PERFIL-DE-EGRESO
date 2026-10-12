"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/app/page-header";
import { Estado, Kpi, Pestanas, Seccion, Tabla, accion, fmtFechaHora, fmtHora, useDatos } from "@/components/app/modulo-ui";
import { api } from "@/lib/fetcher";

interface Conv { id: string; telefono: string; estado: string; handoff: boolean; ultimoMensajeAt: string; ultimo: string | null }
interface Msg { id: string; direccion: "ENTRANTE" | "SALIENTE"; texto: string; autor: string | null; createdAt: string }
interface Config { proveedor: string; identificador: string; botActivo: boolean; bienvenida: string | null; atencionHumana: { dias: number[]; desde: string; hasta: string } | null }
interface Metricas { conversaciones: number; mensajes: number; turnosEmitidos: number; conversion: number; noEntendido: number; handoffs: number; topIntenciones: { intencion: string; n: number }[]; embudo: { estado: string; conversaciones: number }[] }

/** M4 · Chatbot: bandeja con atención humana, flujo, simulador, métricas y configuración del canal. */
export default function Page() {
  const [tab, setTab] = useState<"bandeja" | "probar" | "flujo" | "metricas" | "config">("bandeja");
  const bandeja = useDatos<{ items: Conv[] }>("/api/v1/bot/conversaciones");
  const [sel, setSel] = useState<string | null>(null);
  const msgs = useDatos<Msg[]>(sel ? `/api/v1/bot/conversaciones/${sel}/mensajes` : null, [sel]);
  const [texto, setTexto] = useState("");
  const flujo = useDatos<{ mermaid: string; transiciones: { desde: string; entrada: string; hacia: string }[] }>(tab === "flujo" ? "/api/v1/bot/flujo" : null, [tab]);
  const met = useDatos<Metricas>(tab === "metricas" ? "/api/v1/bot/metricas" : null, [tab]);
  const cfgQ = useDatos<Config>("/api/v1/bot/config");
  const [cfg, setCfg] = useState<Config | null>(null);
  const [sim, setSim] = useState<{ estado?: string; contexto?: Record<string, unknown>; chat: { de: "yo" | "bot"; t: string }[] }>({ chat: [] });
  const [simTexto, setSimTexto] = useState("hola");
  useEffect(() => setCfg(cfgQ.datos), [cfgQ.datos]);

  const actual = bandeja.datos?.items.find((c) => c.id === sel);
  const pendientes = bandeja.datos?.items.filter((c) => c.handoff).length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Chatbot de WhatsApp" description="Los clientes toman turno, consultan su posición, cancelan o agendan escribiendo al número del local." />
      {cfg && !cfg.botActivo && <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">El bot está desactivado. Actívalo en la pestaña Configuración.</p>}
      <Pestanas valor={tab} onCambio={setTab} opciones={[
        { valor: "bandeja", etiqueta: "Bandeja", contador: pendientes },
        { valor: "probar", etiqueta: "Probar chatbot" },
        { valor: "flujo", etiqueta: "Flujo" },
        { valor: "metricas", etiqueta: "Métricas" },
        { valor: "config", etiqueta: "Configuración" },
      ]} />

      {tab === "bandeja" && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <Seccion titulo="Conversaciones" acciones={<Button size="xs" variant="outline" onClick={() => void bandeja.recargar()}>Actualizar</Button>}>
            <Estado cargando={bandeja.cargando} error={bandeja.error} vacio={!bandeja.datos?.items.length} mensajeVacio="Aún no hay conversaciones.">
              <ul className="max-h-[60vh] divide-y overflow-y-auto">
                {bandeja.datos?.items.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => setSel(c.id)} className={`w-full py-2 text-left text-sm ${sel === c.id ? "bg-muted" : ""} ${c.handoff ? "border-l-4 border-rose-500 pl-2" : ""}`}>
                      <p className="flex justify-between font-medium"><span>{c.telefono}</span><span className="text-xs text-muted-foreground">{fmtHora(c.ultimoMensajeAt)}</span></p>
                      <p className="truncate text-xs text-muted-foreground">{c.handoff ? "🙋 Atención humana · " : `${c.estado} · `}{c.ultimo}</p>
                    </button>
                  </li>
                ))}
              </ul>
            </Estado>
          </Seccion>
          <Seccion titulo={actual ? `Chat ${actual.telefono}` : "Elige una conversación"} acciones={actual && (
            <Button size="sm" variant={actual.handoff ? "outline" : "default"} onClick={async () => {
              if (await accion(() => api(`/api/v1/bot/conversaciones/${actual.id}/handoff`, { method: "POST", json: { activo: !actual.handoff } }), actual.handoff ? "Devuelta al bot" : "Tomaste la conversación")) { void bandeja.recargar(); void msgs.recargar(); }
            }}>{actual.handoff ? "Devolver al bot" : "Tomar conversación"}</Button>
          )}>
            {sel && (
              <Estado cargando={msgs.cargando} error={msgs.error}>
                <div className="max-h-[50vh] space-y-2 overflow-y-auto">
                  {msgs.datos?.map((m) => (
                    <div key={m.id} className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.direccion === "ENTRANTE" ? "bg-muted" : "ml-auto bg-teal-700 text-white"}`}>
                      {m.texto}
                      <span className="mt-1 block text-[10px] opacity-70">{fmtFechaHora(m.createdAt)}{m.autor && m.autor !== "bot" && m.direccion === "SALIENTE" ? " · persona" : ""}</span>
                    </div>
                  ))}
                </div>
                {actual?.handoff && (
                  <form className="mt-3 flex gap-2" onSubmit={async (e) => {
                    e.preventDefault();
                    if (await accion(() => api(`/api/v1/bot/conversaciones/${sel}/responder`, { method: "POST", json: { texto } }))) { setTexto(""); void msgs.recargar(); }
                  }}>
                    <Input aria-label="Respuesta" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escribe tu respuesta…" />
                    <Button type="submit" disabled={!texto.trim()}>Enviar</Button>
                  </form>
                )}
              </Estado>
            )}
          </Seccion>
        </div>
      )}

      {tab === "probar" && (
        <Seccion titulo="Probar chatbot" descripcion="Ejecuta la conversación sin enviar mensajes ni crear turnos.">
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {sim.chat.map((m, i) => <div key={i} className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.de === "yo" ? "ml-auto bg-teal-700 text-white" : "bg-muted"}`}>{m.t}</div>)}
          </div>
          <form className="mt-3 flex gap-2" onSubmit={async (e) => {
            e.preventDefault();
            const r = await accion(() => api<{ estado: string; contexto: Record<string, unknown>; respuestas: string[]; efectos: { tipo: string }[] }>("/api/v1/bot/probar", { method: "POST", json: { estado: sim.estado, contexto: sim.contexto, texto: simTexto } }));
            if (r) setSim({ estado: r.estado, contexto: r.contexto, chat: [...sim.chat, { de: "yo", t: simTexto }, ...r.respuestas.map((t) => ({ de: "bot" as const, t })), ...r.efectos.map((ef) => ({ de: "bot" as const, t: `⚙ efecto: ${ef.tipo} (simulado)` }))] });
            setSimTexto("");
          }}>
            <Input aria-label="Mensaje" value={simTexto} onChange={(e) => setSimTexto(e.target.value)} />
            <Button type="submit">Enviar</Button>
            <Button type="button" variant="ghost" onClick={() => setSim({ chat: [] })}>Reiniciar</Button>
          </form>
          {sim.estado && <p className="mt-2 text-xs text-muted-foreground">Estado: {sim.estado}</p>}
        </Seccion>
      )}

      {tab === "flujo" && (
        <Seccion titulo="Flujo del bot" descripcion="Generado desde la tabla de transiciones del código (fuente única de verdad).">
          <Estado cargando={flujo.cargando} error={flujo.error}>
            <Tabla columnas={["Estado", "Entrada", "Siguiente"]} filas={(flujo.datos?.transiciones ?? []).map((t) => [t.desde, t.entrada, t.hacia])} />
            <details className="mt-3 text-xs"><summary className="cursor-pointer">Diagrama Mermaid</summary><pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3">{flujo.datos?.mermaid}</pre></details>
          </Estado>
        </Seccion>
      )}

      {tab === "metricas" && (
        <Estado cargando={met.cargando} error={met.error}>
          {met.datos && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                <Kpi etiqueta="Conversaciones (7 d)" valor={met.datos.conversaciones} />
                <Kpi etiqueta="Mensajes" valor={met.datos.mensajes} />
                <Kpi etiqueta="Turnos por bot" valor={met.datos.turnosEmitidos} tono="bien" />
                <Kpi etiqueta="Conversión" valor={`${met.datos.conversion} %`} />
                <Kpi etiqueta="No entendidos" valor={met.datos.noEntendido} tono={met.datos.noEntendido ? "alerta" : "default"} />
                <Kpi etiqueta="Atención humana" valor={met.datos.handoffs} />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Seccion titulo="Embudo"><Tabla columnas={["Paso", "Conversaciones"]} filas={met.datos.embudo.map((e) => [e.estado, e.conversaciones])} /></Seccion>
                <Seccion titulo="Intenciones más frecuentes"><Tabla columnas={["Intención", "Mensajes"]} filas={met.datos.topIntenciones.map((e) => [e.intencion, e.n])} /></Seccion>
              </div>
            </div>
          )}
        </Estado>
      )}

      {tab === "config" && cfg && (
        <Seccion titulo="Canal y comportamiento" acciones={<Button onClick={async () => { if (await accion(() => api("/api/v1/bot/config", { method: "PUT", json: cfg }), "Configuración guardada")) void cfgQ.recargar(); }}>Guardar</Button>}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-center justify-between rounded-xl border p-3 text-sm sm:col-span-2">Bot activo <Switch checked={cfg.botActivo} onCheckedChange={(v) => setCfg({ ...cfg, botActivo: v })} /></label>
            <div>
              <Label htmlFor="prov">Proveedor</Label>
              <NativeSelect id="prov" value={cfg.proveedor} onChange={(e) => setCfg({ ...cfg, proveedor: e.target.value })}>
                <option value="openwa">OpenWA (auto-hospedado)</option>
                <option value="meta">Meta Cloud API (oficial)</option>
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="ident">{cfg.proveedor === "meta" ? "phone_number_id" : "Sesión de OpenWA"}</Label>
              <Input id="ident" value={cfg.identificador} onChange={(e) => setCfg({ ...cfg, identificador: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="bien">Mensaje de bienvenida</Label>
              <Textarea id="bien" maxLength={300} value={cfg.bienvenida ?? ""} onChange={(e) => setCfg({ ...cfg, bienvenida: e.target.value || null })} placeholder="¡Hola! 👋 Soy el asistente de…" />
            </div>
            <div>
              <Label htmlFor="desde">Atención humana desde</Label>
              <Input id="desde" type="time" value={cfg.atencionHumana?.desde ?? "08:00"} onChange={(e) => setCfg({ ...cfg, atencionHumana: { dias: cfg.atencionHumana?.dias ?? [1, 2, 3, 4, 5], hasta: cfg.atencionHumana?.hasta ?? "17:00", desde: e.target.value } })} />
            </div>
            <div>
              <Label htmlFor="hasta">hasta (lunes a viernes)</Label>
              <Input id="hasta" type="time" value={cfg.atencionHumana?.hasta ?? "17:00"} onChange={(e) => setCfg({ ...cfg, atencionHumana: { dias: cfg.atencionHumana?.dias ?? [1, 2, 3, 4, 5], desde: cfg.atencionHumana?.desde ?? "08:00", hasta: e.target.value } })} />
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Con OpenWA, vuelve a registrar el webhook desde Avisos WhatsApp para recibir el evento <code>message.received</code>.</p>
        </Seccion>
      )}
    </div>
  );
}
