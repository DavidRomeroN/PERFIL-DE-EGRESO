import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Health check para balanceadores (ALB) y monitoreo. */
export async function GET() {
  const inicio = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", db: "up", latencyMs: Date.now() - inicio, version: process.env.npm_package_version ?? "0.1.0", at: new Date().toISOString() });
  } catch (e) {
    return Response.json({ status: "degraded", db: "down", error: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
}
