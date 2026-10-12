"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";
import { Download, ExternalLink, Loader2, Monitor, Printer, Save } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/fetcher";

interface LocalCfg {
  slug: string;
  nombreComercial: string;
  direccion: string | null;
  colorPrimario: string;
  logoUrl: string;
  mensajeTv: string;
  mensajeBienvenida: string;
  avisarFaltando: number;
}

export function PantallaAdmin({ local, claveTv }: { local: LocalCfg; claveTv?: string }) {
  const router = useRouter();
  const [form, setForm] = useState(local);
  const [guardando, setGuardando] = useState(false);
  const [url, setUrl] = useState("");
  const qrRef = useRef<HTMLDivElement>(null);

  useEffect(() => setUrl(`${window.location.origin}/l/${local.slug}`), [local.slug]);

  async function guardar() {
    setGuardando(true);
    try {
      await api("/api/v1/local", {
        method: "PATCH",
        json: { colorPrimario: form.colorPrimario, logoUrl: form.logoUrl, mensajeTv: form.mensajeTv, mensajeBienvenida: form.mensajeBienvenida, avisarFaltando: form.avisarFaltando },
      });
      toast.success("Pantalla actualizada. La TV se refresca sola.");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setGuardando(false);
    }
  }

  function descargarPng() {
    const canvas = qrRef.current?.querySelector("canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.download = `qr-${local.slug}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  }

  return (
    <div>
      <PageHeader title="Pantalla TV y código QR" description="Personaliza lo que ven tus clientes (RF12) y descarga el afiche con el QR para la sala de espera.">
        <Button asChild variant="outline">
          <Link href={`/l/${local.slug}/tv${claveTv ? `?k=${claveTv}` : ""}`} target="_blank" title="Enlace firmado: muestra el PIN de presencia de las citas"><Monitor className="size-4" /> Abrir pantalla TV <ExternalLink className="size-3" /></Link>
        </Button>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Personalización */}
        <section className="rounded-2xl border bg-card p-6 shadow-sm">
          <h2 className="font-semibold">Personalización</h2>
          <div className="mt-4 grid gap-4">
            <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="color">Color principal</Label>
                <div className="flex items-center gap-2">
                  <input id="color" type="color" value={form.colorPrimario} onChange={(e) => setForm({ ...form, colorPrimario: e.target.value })} className="size-10 cursor-pointer rounded-lg border bg-card p-1" />
                  <Input value={form.colorPrimario} onChange={(e) => setForm({ ...form, colorPrimario: e.target.value })} className="font-mono" maxLength={7} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="logo">URL del logo (opcional)</Label>
                <Input id="logo" value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} placeholder="https://…/logo.png" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mtv">Mensaje en la cinta de la TV</Label>
              <Textarea id="mtv" rows={2} value={form.mensajeTv} onChange={(e) => setForm({ ...form, mensajeTv: e.target.value })} maxLength={200} placeholder="Bienvenido. Por favor espere su llamado." />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mb">Mensaje de bienvenida al tomar turno</Label>
              <Textarea id="mb" rows={2} value={form.mensajeBienvenida} onChange={(e) => setForm({ ...form, mensajeBienvenida: e.target.value })} maxLength={200} placeholder="Toma tu turno y espera donde quieras." />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="av">Avisar por WhatsApp cuando falten</Label>
              <div className="flex items-center gap-2">
                <Input id="av" type="number" min={0} max={10} value={form.avisarFaltando} onChange={(e) => setForm({ ...form, avisarFaltando: Number(e.target.value) })} className="w-24" />
                <span className="text-sm text-muted-foreground">personas delante del cliente</span>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={guardar} disabled={guardando}>{guardando ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Guardar cambios</Button>
            </div>
          </div>

          {/* Vista previa */}
          <h3 className="mt-8 text-sm font-semibold text-muted-foreground">Vista previa de la TV</h3>
          <div className="mt-2 overflow-hidden rounded-2xl border bg-slate-950 text-white">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
              <div className="flex items-center gap-2">
                {form.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.logoUrl} alt="" className="size-7 rounded bg-white object-contain p-0.5" />
                ) : (
                  <span className="flex size-7 items-center justify-center rounded text-sm font-bold" style={{ background: form.colorPrimario }}>{local.nombreComercial[0]}</span>
                )}
                <span className="text-sm font-semibold">{local.nombreComercial}</span>
              </div>
              <span className="text-sm tabular">10:42</span>
            </div>
            <div className="grid grid-cols-[1.3fr_1fr] gap-3 p-4">
              <div className="rounded-xl p-4 text-center" style={{ background: `radial-gradient(ellipse at top, color-mix(in oklch, ${form.colorPrimario} 55%, transparent), transparent 70%), rgb(15 23 42)` }}>
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/60">Llamando a</p>
                <p className="font-mono text-4xl font-bold">A-018</p>
                <span className="mt-2 inline-block rounded-lg px-3 py-1 text-sm font-semibold" style={{ background: form.colorPrimario }}>Consultorio 1</span>
              </div>
              <div className="rounded-xl bg-white/5 p-3 text-xs">
                <p className="uppercase tracking-wider text-white/50">En atención</p>
                <p className="mt-2 flex justify-between"><span className="font-mono text-base font-bold">B-009</span><span>Laboratorio</span></p>
                <p className="mt-1 flex justify-between"><span className="font-mono text-base font-bold">C-011</span><span>Caja 1</span></p>
              </div>
            </div>
            <div className="truncate px-4 py-1.5 text-xs text-white/90" style={{ background: `color-mix(in oklch, ${form.colorPrimario} 35%, rgb(2 6 23))` }}>{form.mensajeTv || "Bienvenido. Por favor espere su llamado."}</div>
          </div>
        </section>

        {/* QR */}
        <aside className="space-y-4">
          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <h2 className="font-semibold">Código QR del local</h2>
            <p className="text-xs text-muted-foreground">Imprímelo y colócalo en la entrada, recepción y la sala.</p>
            <div ref={qrRef} className="mt-4 flex justify-center rounded-2xl border bg-white p-4">
              {url && <QRCodeCanvas value={url} size={220} level="H" includeMargin fgColor="#0f172a" />}
            </div>
            <p className="mt-2 break-all text-center font-mono text-xs text-muted-foreground">{url}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={descargarPng}><Download className="size-4" /> PNG</Button>
              <Button onClick={() => window.print()}><Printer className="size-4" /> Afiche</Button>
            </div>
          </div>
        </aside>
      </div>

      {/* Afiche imprimible (solo en impresión) */}
      <div className="hidden print:fixed print:inset-0 print:z-[999] print:flex print:flex-col print:items-center print:justify-center print:bg-white print:text-center">
        <p className="text-5xl font-bold" style={{ color: form.colorPrimario }}>{local.nombreComercial}</p>
        <p className="mt-6 text-3xl font-semibold">Toma tu turno con el celular</p>
        <p className="mt-2 text-xl text-zinc-600">Escanea el código, elige el servicio y espera donde quieras. Te avisamos por WhatsApp cuando falte poco.</p>
        <div className="my-10">{url && <QRCodeSVG value={url} size={420} level="H" fgColor="#0f172a" />}</div>
        <p className="font-mono text-xl text-zinc-600">{url}</p>
        <p className="mt-10 text-lg text-zinc-500">Fila virtual por TurnoYa</p>
      </div>
    </div>
  );
}
