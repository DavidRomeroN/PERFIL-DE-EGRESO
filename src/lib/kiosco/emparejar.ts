const equipos = new Map<string, { localId: number; expira: number }>();

export function crearCodigo(localId: number) {
  const codigo = String(Math.floor(100000 + Math.random() * 900000));
  equipos.set(codigo, { localId, expira: Date.now() + 10 * 60 * 1000 });
  return codigo;
}

export function validarCodigo(codigo: string) {
  const e = equipos.get(codigo.trim());
  if (!e || e.expira < Date.now()) return null;
  return e.localId;
}
