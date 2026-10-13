import type { LucideIcon } from "lucide-react";
import { Numero } from "@/components/app/motion";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, children, className }: { title: string; description?: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-7 flex flex-col gap-3 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-[2rem] md:leading-tight">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

const TONOS = {
  default: { chip: "text-teal-700 bg-teal-50 ring-teal-100", brillo: "from-teal-400/10" },
  good: { chip: "text-emerald-700 bg-emerald-50 ring-emerald-100", brillo: "from-emerald-400/10" },
  warn: { chip: "text-amber-700 bg-amber-50 ring-amber-100", brillo: "from-amber-400/10" },
  bad: { chip: "text-rose-700 bg-rose-50 ring-rose-100", brillo: "from-rose-400/10" },
} as const;

/**
 * Tarjeta de indicador. Si `value` es un número transiciona al cambiar (datos en vivo);
 * `sufijo` acompaña al número (p. ej. " min", "%").
 */
export function StatCard({ label, value, sufijo, hint, icon: Icon, tone = "default", indice = 0 }: { label: string; value: React.ReactNode; sufijo?: string; hint?: string; icon?: LucideIcon; tone?: keyof typeof TONOS; indice?: number }) {
  const t = TONOS[tone];
  return (
    <div className="relative animate-enter stagger overflow-hidden rounded-2xl border bg-card p-5 shadow-soft" style={{ ["--i" as string]: indice }}>
      <div className={cn("pointer-events-none absolute -right-10 -top-10 size-32 rounded-full bg-radial to-transparent to-70%", t.brillo)} aria-hidden />
      <div className="relative flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon && (
          <span className={cn("rounded-xl p-2 ring-1 transition-colors duration-300", t.chip)}>
            <Icon className="size-4" />
          </span>
        )}
      </div>
      <p className="relative mt-2 text-3xl font-semibold tracking-tight tabular-nums">{typeof value === "number" ? <Numero valor={value} sufijo={sufijo} /> : value}</p>
      {hint && <p className="relative mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, children }: { icon?: LucideIcon; title: string; description?: string; children?: React.ReactNode }) {
  return (
    <div className="flex animate-enter flex-col items-center justify-center rounded-2xl border border-dashed bg-card/50 p-10 text-center">
      {Icon && (
        <span className="flex size-14 items-center justify-center rounded-2xl bg-muted/70 text-muted-foreground ring-1 ring-border">
          <Icon className="size-7" />
        </span>
      )}
      <p className="mt-4 font-semibold">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
