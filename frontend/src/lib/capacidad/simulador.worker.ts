/// <reference lib="webworker" />
import { monteCarlo, tornado, type ParametrosSim } from "@backend/capacidad/des";

/** M8 · Web Worker: corre el Monte Carlo sin congelar la UI; reporta progreso y acepta cancelación. */
let cancelado = false;

self.onmessage = (e: MessageEvent<{ tipo: "EJECUTAR" | "TORNADO" | "CANCELAR"; parametros?: ParametrosSim }>) => {
  if (e.data.tipo === "CANCELAR") {
    cancelado = true;
    return;
  }
  cancelado = false;
  if (e.data.tipo === "TORNADO" && e.data.parametros) {
    (self as unknown as Worker).postMessage({ tipo: "TORNADO", datos: tornado(e.data.parametros, 200) });
    return;
  }
  if (e.data.tipo === "EJECUTAR" && e.data.parametros) {
    const r = monteCarlo(e.data.parametros, {
      alProgreso: (pct) => (self as unknown as Worker).postMessage({ tipo: "PROGRESO", pct }),
      cancelado: () => cancelado,
    });
    (self as unknown as Worker).postMessage(r ? { tipo: "RESULTADO", datos: r } : { tipo: "CANCELADO" });
  }
};
