import { ok } from "@/lib/api";
import { ADMIN, enLocal } from "@/lib/rutas";
import { TABLA, diagramaMermaid } from "@/lib/bot/fsm";

/** GET /api/v1/bot/flujo — diagrama Mermaid generado desde la tabla de transiciones del código */
export const GET = enLocal(ADMIN, "M4", async () => ok({ mermaid: diagramaMermaid(), transiciones: TABLA.map(([desde, entrada, hacia]) => ({ desde, entrada, hacia })) }));
