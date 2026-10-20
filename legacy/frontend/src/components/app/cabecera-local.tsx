import { MapPin } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";

/** Cabecera con la marca del local (color, logo, dirección) para las pantallas del cliente. */
export function CabeceraLocal({
  local,
  sobretitulo,
  children,
}: {
  local: { nombreComercial: string; rubro?: string | null; direccion: string | null; colorPrimario: string; logoUrl: string | null };
  sobretitulo?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="relative overflow-hidden text-white" style={{ background: `linear-gradient(135deg, ${local.colorPrimario}, color-mix(in oklch, ${local.colorPrimario} 62%, black))` }}>
      <div className="pointer-events-none absolute -right-16 -top-24 size-64 animate-drift rounded-full bg-white/15 blur-3xl" aria-hidden />
      <div className="bg-noise pointer-events-none absolute inset-0 opacity-[0.07] mix-blend-overlay" aria-hidden />
      <div className="relative mx-auto flex max-w-lg animate-enter items-center gap-3 px-5 pb-12 pt-6">
        {local.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={local.logoUrl} alt="" className="size-12 rounded-xl bg-white/90 object-contain p-1 shadow-sm" />
        ) : (
          <LogoMark className="size-12 rounded-2xl bg-white/15 from-white/25 to-white/5 ring-1 ring-white/20 backdrop-blur" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-white/70">{sobretitulo ?? local.rubro}</p>
          <h1 className="truncate text-xl font-semibold tracking-tight">{local.nombreComercial}</h1>
          {local.direccion && (
            <p className="flex items-center gap-1 truncate text-xs text-white/80">
              <MapPin className="size-3 shrink-0" /> {local.direccion}
            </p>
          )}
        </div>
        {children}
      </div>
    </header>
  );
}
