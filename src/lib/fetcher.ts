export class ApiError extends Error {
  constructor(
    public codigo: string,
    mensaje: string,
    public status: number,
    public extra?: Record<string, unknown>,
  ) {
    super(mensaje);
  }
}

/** Cliente HTTP para /api/v1 — desempaqueta { ok, data } y lanza ApiError con el mensaje de negocio. */
export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });
  let payload: { ok: boolean; data?: T; error?: { codigo: string; mensaje: string } & Record<string, unknown> } | null = null;
  try {
    payload = await res.json();
  } catch {
    /* sin cuerpo */
  }
  if (!res.ok || !payload?.ok) {
    const err = payload?.error;
    const { codigo, mensaje, ...extra } = err ?? { codigo: "HTTP_" + res.status, mensaje: res.statusText || "Error de red" };
    throw new ApiError(codigo, mensaje, res.status, extra);
  }
  return payload.data as T;
}
