import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { localActualAdmin } from "@/lib/admin";
import { moduloActivo } from "@/lib/modulos";

export const dynamic = "force-dynamic";

const LISTA = ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8"];
const NOMBRE: Record<string, string> = {
  M1: "Prioridades", M2: "Predicción", M3: "Citas", M4: "Chatbot", M5: "Kiosco", M6: "Transferencia", M7: "Analítica", M8: "Simulador",
};

export default async function Page() {
  const session = await getSession();
  if (!session) redirect("/login");
  const local = await localActualAdmin(session);
  if (!local) redirect("/admin/locales");
  return (
    <div>
      <h1 className="text-2xl font-semibold">Módulos del plan {local.plan.nombre}</h1>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {LISTA.map((m) => {
          const on = moduloActivo(local.plan.codigo, m);
          return (
            <li key={m} className="rounded-2xl border bg-card p-4">
              <p className="font-medium">{NOMBRE[m]}</p>
              <p className="text-sm text-muted-foreground">{on ? "Incluido en el plan" : "No incluido en este plan"}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
