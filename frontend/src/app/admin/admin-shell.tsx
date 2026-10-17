"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGroup, motion } from "motion/react";
import {
  Activity,
  ArrowRightLeft,
  Bell,
  BrainCircuit,
  CalendarDays,
  Calculator,
  Clock,
  Cpu,
  CreditCard,
  Layers,
  ScrollText,
  Tablet,
  BarChart3,
  Building2,
  Columns3,
  ExternalLink,
  LayoutDashboard,
  ListOrdered,
  Menu,
  MessageCircle,
  Monitor,
  QrCode,
  Settings,
  Store,
  Timer,
  Users,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Logo } from "@/components/brand/logo";
import { UserMenu } from "@/components/app/user-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { api } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import type { Session } from "@backend/auth";
import { useRealtime } from "@/hooks/use-realtime";

export interface LocalShell {
  id: number;
  slug: string;
  nombreComercial: string;
  colorPrimario: string;
  plan: string;
  planCodigo: string;
}

interface ItemNav {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV: ItemNav[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/colas", label: "Colas y servicios", icon: ListOrdered },
  { href: "/admin/ventanillas", label: "Ventanillas", icon: Columns3 },
  { href: "/admin/usuarios", label: "Usuarios", icon: Users },
  { href: "/admin/reportes", label: "Reportes", icon: BarChart3 },
  { href: "/admin/notificaciones", label: "Avisos WhatsApp", icon: MessageCircle },
  { href: "/admin/pantalla", label: "Pantalla TV y QR", icon: QrCode },
  { href: "/admin/operacion", label: "Horario y ausencias", icon: Clock },
  { href: "/admin/configuracion", label: "Configuración", icon: Settings },
  { href: "/admin/plan", label: "Mi plan y pagos", icon: CreditCard },
  { href: "/admin/auditoria", label: "Auditoría", icon: ScrollText },
  { href: "/admin/modulos", label: "Módulos", icon: Layers },
];

/** Entradas de módulos: solo aparecen si el módulo está activo en el local (F3). */
const NAV_MODULOS: (ItemNav & { codigo: string })[] = [
  { codigo: "M1", href: "/admin/modulos/prioridades", label: "Prioridades", icon: Timer },
  { codigo: "M2", href: "/admin/modulos/prediccion", label: "Predicción", icon: BrainCircuit },
  { codigo: "M3", href: "/admin/modulos/citas", label: "Citas", icon: CalendarDays },
  { codigo: "M4", href: "/admin/bandeja", label: "Chatbot", icon: MessageCircle },
  { codigo: "M5", href: "/admin/modulos/kiosco", label: "Kiosco", icon: Tablet },
  { codigo: "M6", href: "/admin/modulos/balanceo", label: "Balanceo", icon: ArrowRightLeft },
  { codigo: "M7", href: "/admin/analitica", label: "Analítica y alertas", icon: Activity },
  { codigo: "M8", href: "/admin/simulador", label: "Simulador", icon: Calculator },
];

const NAV_PLATAFORMA: ItemNav[] = [
  { href: "/admin/planes", label: "Planes y módulos", icon: Layers },
  { href: "/admin/jobs", label: "Jobs programados", icon: Cpu },
  { href: "/admin/locales", label: "Locales y planes", icon: Building2 },
];

/** Ruta del menú que corresponde a la página actual (la coincidencia más específica gana). */
function rutaActiva(pathname: string, rutas: string[]) {
  return rutas.filter((r) => (r === "/admin" ? pathname === "/admin" : pathname === r || pathname.startsWith(`${r}/`))).sort((a, b) => b.length - a.length)[0] ?? null;
}

function CampanaAlertas({ slug }: { slug: string | null }) {
  const router = useRouter();
  const [resumen, setResumen] = useState<{ activo: boolean; abiertas: number } | null>(null);
  const cargar = useCallback(() => api<{ activo: boolean; abiertas: number }>("/api/v1/alertas/resumen").then(setResumen).catch(() => {}), []);
  useEffect(() => {
    void cargar();
    const t = setInterval(cargar, 30_000);
    return () => clearInterval(t);
  }, [cargar]);
  useRealtime(slug, (e) => {
    if (e.tipo === "alerta:nueva") {
      toast.warning(`Alerta: ${e.alerta.titulo}`, { action: { label: "Ver", onClick: () => router.push("/admin/analitica?tab=alertas") } });
      void cargar();
    }
    if (e.tipo === "alerta:actualizada") void cargar();
  });
  if (!resumen?.activo) return null;
  return (
    <Link href="/admin/analitica?tab=alertas" className="press relative inline-flex rounded-lg p-2 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground" aria-label={`${resumen.abiertas} alertas abiertas`}>
      <Bell className="size-4.5" />
      {resumen.abiertas > 0 && (
        // La clave reinicia la animación: el contador "salta" cada vez que cambia
        <span key={resumen.abiertas} className="absolute -right-0.5 -top-0.5 min-w-4 animate-pop rounded-full bg-rose-600 px-1 text-center text-[10px] font-bold text-white tabular-nums ring-2 ring-sidebar">
          {resumen.abiertas}
        </span>
      )}
    </Link>
  );
}

function EnlaceNav({ item, activo, onNavegar }: { item: ItemNav; activo: boolean; onNavegar: () => void }) {
  const Icono = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavegar}
      aria-current={activo ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-sidebar-foreground/65 transition-colors duration-200 hover:text-sidebar-accent-foreground",
        activo && "text-sidebar-accent-foreground",
      )}
    >
      {activo ? (
        <motion.span layoutId="nav-activo" className="absolute inset-0 rounded-xl bg-sidebar-accent shadow-sm ring-1 ring-white/5" transition={{ type: "spring", duration: 0.4, bounce: 0.1 }} aria-hidden>
          <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-sidebar-primary" />
        </motion.span>
      ) : (
        <span className="absolute inset-0 rounded-xl bg-sidebar-accent/0 transition-colors duration-200 group-hover:bg-sidebar-accent/50" aria-hidden />
      )}
      <Icono className={cn("relative size-4.5 transition-colors duration-200", activo ? "text-sidebar-primary" : "group-hover:text-sidebar-foreground")} />
      <span className="relative">{item.label}</span>
    </Link>
  );
}

export function AdminShell({ session, local, locales, modulos, children }: { session: Session; local: LocalShell | null; locales: { id: number; slug: string; nombreComercial: string; activo: boolean }[]; modulos: string[]; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const esSuper = session.rol === "SUPER_ADMIN";

  async function cambiarLocal(id: number) {
    try {
      await api("/api/v1/locales/activo", { method: "POST", json: { localId: id } });
      router.refresh();
      toast.success("Local cambiado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cambiar el local");
    }
  }

  const modulosVisibles = NAV_MODULOS.filter((m) => modulos.includes(m.codigo));
  const todas = [...NAV, ...modulosVisibles, ...(esSuper ? NAV_PLATAFORMA : [])];
  const activa = rutaActiva(pathname, todas.map((n) => n.href));
  const cerrar = () => setAbierto(false);

  const grupo = (titulo: string | null, items: ItemNav[]) =>
    items.length > 0 && (
      <div className="flex flex-col gap-0.5">
        {titulo && <p className="mb-1 mt-5 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/40">{titulo}</p>}
        {items.map((n) => (
          <EnlaceNav key={n.href} item={n} activo={activa === n.href} onNavegar={cerrar} />
        ))}
      </div>
    );

  const sidebar = (variante: "escritorio" | "movil") => (
    <div className="flex h-full flex-col overflow-y-auto bg-sidebar text-sidebar-foreground [scrollbar-color:var(--sidebar-border)_transparent] [scrollbar-width:thin]">
      <div className={cn("flex items-center justify-between px-5 py-5", variante === "movil" && "pr-14")}>
        <Logo light href="/admin" />
        <CampanaAlertas slug={local?.slug ?? null} />
      </div>

      {/* Local actual */}
      <div className="mx-3 mb-4 rounded-2xl border border-sidebar-border bg-gradient-to-b from-sidebar-accent/80 to-sidebar-accent/40 p-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/50">
          <Store className="size-3.5" /> Local
        </p>
        {esSuper && locales.length > 0 ? (
          <NativeSelect value={local?.id ?? ""} onChange={(e) => cambiarLocal(Number(e.target.value))} className="mt-1.5 h-9 border-sidebar-border bg-sidebar text-sidebar-foreground">
            {locales.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nombreComercial}
                {!l.activo ? " (inactivo)" : ""}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <p className="mt-1 truncate font-medium">{local?.nombreComercial ?? "Sin local"}</p>
        )}
        {local && (
          <div className="mt-2 flex items-center justify-between">
            <Badge className="bg-sidebar-primary/20 text-sidebar-primary">Plan {local.plan}</Badge>
            <Link href={`/l/${local.slug}/tv`} target="_blank" className="inline-flex items-center gap-1 text-xs text-sidebar-foreground/60 transition-colors hover:text-sidebar-foreground">
              <Monitor className="size-3.5" /> TV <ExternalLink className="size-3" />
            </Link>
          </div>
        )}
      </div>

      <LayoutGroup id={`nav-${variante}`}>
        <nav aria-label="Administración" className="flex flex-1 flex-col px-3">
          {grupo(null, NAV)}
          {grupo("Módulos activos", modulosVisibles)}
          {esSuper && grupo("Plataforma", NAV_PLATAFORMA)}
        </nav>
      </LayoutGroup>

      <div className="mt-auto space-y-2 p-3 pt-6">
        <Button asChild variant="outline" className="w-full border-sidebar-border bg-transparent text-sidebar-foreground shadow-none hover:border-sidebar-primary/40 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
          <Link href="/panel">
            <LayoutDashboard className="size-4" /> Ir al panel de ventanilla
          </Link>
        </Button>
        <div className="flex items-center justify-between rounded-xl border border-sidebar-border p-2">
          <UserMenu session={session} light />
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-muted/30">
      {/* Sidebar escritorio */}
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 lg:block">{sidebar("escritorio")}</aside>

      {/* Sidebar móvil: cajón que se desliza desde la izquierda */}
      <Sheet open={abierto} onOpenChange={setAbierto}>
        <SheetContent side="left" className="w-72 max-w-[85vw] gap-0 border-sidebar-border bg-sidebar p-0 lg:hidden [&>[data-slot=sheet-close]]:text-sidebar-foreground [&>[data-slot=sheet-close]]:hover:bg-sidebar-accent">
          <SheetTitle className="sr-only">Menú de administración</SheetTitle>
          {sidebar("movil")}
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card/80 px-4 backdrop-blur-md lg:hidden">
          <button type="button" onClick={() => setAbierto(true)} aria-label="Abrir menú" aria-expanded={abierto} className="press rounded-lg border p-2 hover:bg-muted">
            <Menu className="size-4" />
          </button>
          <Logo href="/admin" />
        </header>
        <main id="contenido" className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
