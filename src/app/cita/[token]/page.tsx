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
  return (
    <main className="mx-auto max-w-md px-5 py-16 text-center">
      <h1 className="text-2xl font-semibold">Check-in de tu cita</h1>
      <p className="mt-2 text-sm text-muted-foreground">Disponible desde 20 minutos antes hasta 15 minutos después de la hora.</p>
      <Button className="mt-6" disabled={ok} onClick={async () => {
        try {
          const t = await api<{ token: string }>("/api/v1/operacion", { method: "PUT", json: { accion: "checkin", token } });
          setOk(true);
          router.push(`/t/${t.token}`);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "No se pudo hacer check-in");
        }
      }}>Llegué, dame mi turno</Button>
    </main>
  );
}
