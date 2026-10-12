import { prisma } from "@/lib/db";
import { estadoJobs } from "@/lib/jobs/scheduler";

export const dynamic = "force-dynamic";

/** Health check (F1): BD y último latido de cada job. */
export async function GET() {
  const inicio = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const jobs = await estadoJobs().catch(() => []);
    const atrasados = jobs.filter((j) => j.proxima && Date.now() - new Date(j.proxima).getTime() > 5 * 60_000);
    return Response.json({
      status: atrasados.length ? "degraded" : "ok",
      db: "up",
      latencyMs: Date.now() - inicio,
      version: process.env.npm_package_version ?? "0.2.0",
      jobs: jobs.map((j) => ({ nombre: j.nombre, ultimaCorrida: j.ultimaCorrida, ultimoError: j.ultimoError, fallos: j.fallos })),
      jobsAtrasados: atrasados.map((j) => j.nombre),
      at: new Date().toISOString(),
    });
  } catch (e) {
    return Response.json({ status: "degraded", db: "down", error: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
}
