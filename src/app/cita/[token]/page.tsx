"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/fetcher";
import { toast } from "sonner";

export default function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [ok, setOk] = useState(false);
  const [pin, setPin] = useState("");
  return (
    <main className="mx-auto max-w-md px-5 py-16 text-center">
      <h1 className="text-2xl font-semibold">Check-in de tu cita</h1>
      <p className="mt-2 text-sm text-muted-foreground">Disponible desde 20 minutos antes hasta 15 minutos después de la hora.</p>
      <input className="mx-auto mt-6 block h-12 w-32 rounded-xl border text-center font-mono text-xl uppercase" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN" />
      <Button className="mt-4" disabled={ok || pin.length < 4} onClick={async () => {
        try {
          const t = await api<{ token: string }>(`/api/v1/public/citas/${token}/checkin`, { method: "POST", json: { pin } });
          setOk(true);
          router.push(`/t/${t.token}`);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "No se pudo hacer check-in");
        }
      }}>Llegué, dame mi turno</Button>
    </main>
  );
}
