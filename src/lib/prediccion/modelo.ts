import { ajustarModelos } from "@/lib/prediccion/modelos";

const estado = { mediaMin: 8, muestras: 0, actualizado: "", modelo: "BASELINE" };

export function modeloActual() {
  return { ...estado };
}

export function reentrenar(esperasMin: number[], horas?: number[]) {
  if (esperasMin.length === 0) return modeloActual();
  const muestras = esperasMin.map((esperaMin, i) => ({ esperaMin, hora: horas?.[i] ?? 12 }));
  const mejor = ajustarModelos(muestras);
  estado.mediaMin = mejor.predecir(new Date().getHours());
  estado.modelo = mejor.nombre;
  estado.muestras += esperasMin.length;
  estado.actualizado = new Date().toISOString();
  return modeloActual();
}
