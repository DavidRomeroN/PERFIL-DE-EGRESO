import { ok } from "@backend/api";
import { ADMIN, enLocal } from "@backend/rutas";
import { TABLA, diagramaMermaid } from "@backend/bot/fsm";

/** GET /api/v1/bot/flujo — diagrama Mermaid generado desde la tabla de transiciones del código */
export const GET = enLocal(ADMIN, "M4", async () => ok({ mermaid: diagramaMermaid(), transiciones: TABLA.map(([desde, entrada, hacia]) => ({ desde, entrada, hacia })) }));
