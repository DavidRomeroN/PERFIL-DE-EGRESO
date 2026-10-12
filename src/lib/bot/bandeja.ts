export interface MensajeBandeja {
  id: number;
  telefono: string;
  texto: string;
  at: string;
  respondido: boolean;
}

const mensajes: MensajeBandeja[] = [];
let seq = 1;

export function dejarEnBandeja(telefono: string, texto: string) {
  mensajes.unshift({ id: seq++, telefono, texto, at: new Date().toISOString(), respondido: false });
  if (mensajes.length > 100) mensajes.pop();
}

export function listarBandeja() {
  return mensajes;
}

export function marcarRespondido(id: number, respuesta: string) {
  const m = mensajes.find((x) => x.id === id);
  if (!m) return null;
  m.respondido = true;
  m.texto = `${m.texto} → ${respuesta}`;
  return m;
}
