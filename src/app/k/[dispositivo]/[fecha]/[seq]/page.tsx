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
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-2xl font-bold">Ticket K{p.dispositivo}-{p.seq.padStart(4, "0")}</h1>
      {estado === "REVISION" ? (
        <p>Tu ticket está en revisión. Acércate al mostrador con tu ticket impreso.</p>
      ) : (
        <p aria-live="polite">Tu turno se está registrando. Esta página se actualizará sola cuando tenga su número definitivo.</p>
      )}
    </main>
  );
}
