"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
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
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Logo } from "@/components/brand/logo";
import { UserMenu } from "@/components/app/user-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { api } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import type { Session } from "@/lib/auth";

export interface LocalShell {
  id: number;
  slug: string;
  nombreComercial: string;
  colorPrimario: string;
  plan: string;
  planCodigo: string;
}

const NAV = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/colas", label: "Colas y servicios", icon: ListOrdered },
  { href: "/admin/ventanillas", label: "Ventanillas", icon: Columns3 },
  { href: "/admin/usuarios", label: "Usuarios", icon: Users },
  { href: "/admin/reportes", label: "Reportes", icon: BarChart3 },
  { href: "/admin/notificaciones", label: "Avisos WhatsApp", icon: MessageCircle },
  { href: "/admin/pantalla", label: "Pantalla TV y QR", icon: QrCode },
  { href: "/admin/configuracion", label: "Configuración", icon: Settings },
  { href: "/admin/operacion", label: "Prioridades y citas", icon: Timer },
  { href: "/admin/simulador", label: "Simulador", icon: BarChart3 },
];

export function AdminShell({ session, local, locales, children }: { session: Session; local: LocalShell | null; locales: { id: number; slug: string; nombreComercial: string; activo: boolean }[]; children: React.ReactNode }) {
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

  const nav = (
    <nav className="flex flex-1 flex-col gap-1 px-3">
      {NAV.map((n) => {
        const activo = n.href === "/admin" ? pathname === "/admin" : pathname.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={() => setAbierto(false)}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              activo && "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm",
            )}
          >
            <n.icon className={cn("size-4.5", activo && "text-sidebar-primary")} />
            {n.label}
          </Link>
        );
      })}
      {esSuper && (
        <>
          <p className="mt-4 px-3 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">Plataforma</p>
          <Link
            href="/admin/locales"
            onClick={() => setAbierto(false)}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              pathname.startsWith("/admin/locales") && "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm",
            )}
          >
            <Building2 className={cn("size-4.5", pathname.startsWith("/admin/locales") && "text-sidebar-primary")} /> Locales y planes
          </Link>
        </>
      )}
    </nav>
  );

  const sidebar = (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between px-5 py-5">
        <Logo light href="/admin" />
        <button type="button" className="lg:hidden" onClick={() => setAbierto(false)} aria-label="Cerrar menú">
          <X className="size-5" />
        </button>
      </div>

      {/* Local actual */}
      <div className="mx-3 mb-4 rounded-2xl border border-sidebar-border bg-sidebar-accent/60 p-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50"><Store className="size-3.5" /> Local</p>
        {esSuper && locales.length > 0 ? (
          <NativeSelect value={local?.id ?? ""} onChange={(e) => cambiarLocal(Number(e.target.value))} className="mt-1.5 h-9 border-sidebar-border bg-sidebar text-sidebar-foreground">
            {locales.map((l) => (
              <option key={l.id} value={l.id}>{l.nombreComercial}{!l.activo ? " (inactivo)" : ""}</option>
            ))}
          </NativeSelect>
        ) : (
          <p className="mt-1 truncate font-medium">{local?.nombreComercial ?? "Sin local"}</p>
        )}
        {local && (
          <div className="mt-2 flex items-center justify-between">
            <Badge className="bg-sidebar-primary/20 text-sidebar-primary">Plan {local.plan}</Badge>
            <Link href={`/l/${local.slug}/tv`} target="_blank" className="inline-flex items-center gap-1 text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground">
              <Monitor className="size-3.5" /> TV <ExternalLink className="size-3" />
            </Link>
          </div>
        )}
      </div>

      {nav}

      <div className="mt-auto space-y-2 p-3">
        <Button asChild variant="outline" className="w-full border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
          <Link href="/panel"><LayoutDashboard className="size-4" /> Ir al panel de ventanilla</Link>
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
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 lg:block">{sidebar}</aside>

      {/* Sidebar móvil */}
      {abierto && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setAbierto(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 shadow-2xl">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card/80 px-4 backdrop-blur lg:hidden">
          <button type="button" onClick={() => setAbierto(true)} aria-label="Abrir menú" className="rounded-lg border p-2">
            <Menu className="size-4" />
          </button>
          <Logo href="/admin" />
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
