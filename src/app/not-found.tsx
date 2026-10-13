import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";

export default function NotFound() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-grid px-6 text-center">
      <div className="pointer-events-none absolute inset-0 bg-radial from-transparent to-background to-70%" aria-hidden />
      <div className="relative flex flex-col items-center">
        <div className="animate-enter">
          <Logo />
        </div>
        <div className="mt-10 flex size-20 animate-pop items-center justify-center rounded-3xl bg-teal-50 text-teal-700 shadow-soft ring-1 ring-teal-100 [animation-delay:120ms]">
          <SearchX className="size-10 animate-float" />
        </div>
        <h1 className="mt-6 animate-enter text-3xl font-semibold tracking-tight [animation-delay:180ms]">No encontramos lo que buscas</h1>
        <p className="mt-2 max-w-md animate-enter text-balance text-muted-foreground [animation-delay:240ms]">
          El enlace puede estar vencido o el local / turno ya no existe. Si escaneaste un QR, vuelve a intentarlo desde el local.
        </p>
        <div className="mt-8 flex animate-enter gap-3 [animation-delay:300ms]">
          <Button asChild><Link href="/">Ir al inicio</Link></Button>
          <Button asChild variant="outline"><Link href="/login">Iniciar sesión</Link></Button>
        </div>
      </div>
    </main>
  );
}
