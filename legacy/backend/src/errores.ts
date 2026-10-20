/** Error de negocio con código estable (ADR-04): la API lo traduce a `{ ok:false, error:{ codigo, mensaje } }`. */
export class ErrorNegocio extends Error {
  constructor(
    public codigo: string,
    mensaje: string,
    public status = 400,
    public extra?: Record<string, unknown>,
  ) {
    super(mensaje);
  }
}
