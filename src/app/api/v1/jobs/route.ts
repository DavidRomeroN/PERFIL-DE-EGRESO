import { conRol, ok } from "@/lib/api";
import { estadoJobs } from "@/lib/jobs/scheduler";

/** GET /api/v1/jobs — estado de los jobs programados (F1, solo SUPER_ADMIN) */
export const GET = conRol(["SUPER_ADMIN"], async () => ok(await estadoJobs()));
