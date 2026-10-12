import { z } from "zod";
import { auditar, ok, parseBody } from "@/lib/api";
import { ADMIN, enLocal } from "@/lib/rutas";
import { crearDispositivo, listarDispositivos } from "@/lib/kiosco/service";

const schema = z.object({ nombre: z.string().trim().min(2).max(40), colaIds: z.array(z.number().int().positive()).max(20).default([]) });

export const GET = enLocal(ADMIN, "M5", async (_req, ctx) => ok(await listarDispositivos(ctx.localId)));

/** POST /api/v1/kiosco/dispositivos — crea el kiosco y devuelve el código de emparejamiento (10 min) */
export const POST = enLocal(ADMIN, "M5", async (req, ctx) => {
  const b = await parseBody(req, schema);
  const r = await crearDispositivo(ctx.localId, b.nombre, b.colaIds);
  await auditar(ctx, { localId: ctx.localId, accion: "KIOSCO_CREAR", entidad: "dispositivo_kiosco", entidadId: r.dispositivo.id, humana: `Registró el kiosco ${r.dispositivo.prefijo} (${b.nombre})` });
  return ok(r, { status: 201 });
});
