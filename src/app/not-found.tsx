import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-grid px-6 text-center">
      <Logo />
      <div className="mt-10 flex size-20 items-center justify-center rounded-3xl bg-teal-50 text-teal-700 ring-1 ring-teal-100">
        <SearchX className="size-10" />
      </div>
      <h1 className="mt-6 text-3xl font-bold tracking-tight">No encontramos lo que buscas</h1>
      <p className="mt-2 max-w-md text-balance text-muted-foreground">
        El enlace puede estar vencido o el local / turno ya no existe. Si escaneaste un QR, vuelve a intentarlo desde el local.
      </p>
      <div className="mt-8 flex gap-3">
        <Button asChild><Link href="/">Ir al inicio</Link></Button>
        <Button asChild variant="outline"><Link href="/login">Iniciar sesión</Link></Button>
      </div>
    </main>
  );
}
