"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ROL_LABEL } from "@/lib/format";
import type { Session } from "@/lib/auth";
import { cn } from "@/lib/utils";

export function UserMenu({ session, light = false, compact = false }: { session: Session; light?: boolean; compact?: boolean }) {
  const router = useRouter();
  async function salir() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    toast.success("Sesión cerrada");
    router.push("/login");
    router.refresh();
  }
  const iniciales = session.nombre
    .split(" ")
    .filter((p) => p.length > 2)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <div className="flex items-center gap-3">
      <div className={cn("flex items-center gap-2.5", compact && "hidden sm:flex")}>
        <span className={cn("flex size-9 items-center justify-center rounded-full text-xs font-semibold", light ? "bg-white/15 text-white" : "bg-teal-100 text-teal-800")}>{iniciales || "U"}</span>
        <div className="hidden min-w-0 leading-tight md:block">
          <p className={cn("truncate text-sm font-medium", light && "text-white")}>{session.nombre}</p>
          <p className={cn("truncate text-xs", light ? "text-white/60" : "text-muted-foreground")}>{ROL_LABEL[session.rol]}{session.localNombre ? ` · ${session.localNombre}` : ""}</p>
        </div>
      </div>
      <Button variant={light ? "ghost" : "outline"} size="icon-sm" onClick={salir} title="Cerrar sesión" className={cn(light && "text-white hover:bg-white/10 hover:text-white")}>
        <LogOut className="size-4" />
      </Button>
    </div>
  );
}
