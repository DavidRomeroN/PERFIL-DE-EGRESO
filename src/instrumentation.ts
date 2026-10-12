export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { expirarLlamados } = await import("@/lib/operacion");
  setInterval(() => {
    void expirarLlamados().catch(() => {});
  }, 30_000);
}
