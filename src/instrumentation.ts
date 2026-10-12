export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { correrJobs } = await import("@/lib/jobs/runner");
  setInterval(() => {
    void correrJobs().catch(() => {});
  }, 30_000);
}
