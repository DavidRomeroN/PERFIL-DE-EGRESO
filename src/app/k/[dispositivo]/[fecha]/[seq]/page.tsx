"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** M5 · QR del ticket provisional: redirige al turno definitivo apenas el kiosco sincroniza. */
export default function Page({ params }: { params: Promise<{ dispositivo: string; fecha: string; seq: string }> }) {
  const p = use(params);
  const router = useRouter();
  const [estado, setEstado] = useState("PENDIENTE");

  useEffect(() => {
    let vivo = true;
    const revisar = async () => {
      const r = await fetch(`/api/v1/public/k/${p.dispositivo}/${p.fecha}/${p.seq}`).then((x) => x.json()).catch(() => null);
      if (!vivo) return;
      if (r?.data?.estado === "LISTO") router.replace(`/t/${r.data.token}`);
      else setEstado(r?.data?.estado ?? "PENDIENTE");
    };
    void revisar();
    const t = setInterval(revisar, 10_000);
    return () => { vivo = false; clearInterval(t); };
  }, [p, router]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md animate-enter-soft flex-col items-center justify-center gap-4 p-8 text-center">
      {estado === "REVISION" ? (
        <span className="flex size-14 animate-pop items-center justify-center rounded-full bg-amber-100 text-2xl text-amber-700 ring-8 ring-amber-50">!</span>
      ) : (
        <span className="relative flex size-14 items-center justify-center" aria-hidden>
          <span className="absolute inset-0 rounded-full border-4 border-teal-100" />
          <span className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-teal-600 [animation-duration:900ms]" />
        </span>
      )}
      <h1 className="text-2xl font-semibold tracking-tight">Ticket <span className="font-mono">K{p.dispositivo}-{p.seq.padStart(4, "0")}</span></h1>
      {estado === "REVISION" ? (
        <p className="text-muted-foreground">Tu ticket está en revisión. Acércate al mostrador con tu ticket impreso.</p>
      ) : (
        <p aria-live="polite" className="text-muted-foreground">Tu turno se está registrando. Esta página se actualizará sola cuando tenga su número definitivo.</p>
      )}
    </main>
  );
}
