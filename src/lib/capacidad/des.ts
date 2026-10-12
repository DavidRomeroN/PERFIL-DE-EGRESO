/** Simulación de eventos discretos de una cola M/M/c con abandono. */
export interface ResultadoDes {
  replicas: number;
  esperaMediaMin: number;
  esperaP90Min: number;
  abandono: number;
  atendidos: number;
}

function exp(rng: () => number, media: number) {
  return -Math.log(1 - rng()) * media;
}

export function simularCola(opts: {
  llegadasPorHora: number;
  servicioMin: number;
  servidores: number;
  horas: number;
  replicas: number;
  pacienciaMin?: number;
  semilla?: number;
}): ResultadoDes {
  let seed = opts.semilla ?? 1;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const esperas: number[] = [];
  let abandonos = 0;
  let atendidos = 0;
  const mediaLlegada = 60 / Math.max(opts.llegadasPorHora, 0.1);
  const paciencia = opts.pacienciaMin ?? 30;
  for (let r = 0; r < opts.replicas; r++) {
    const fin = opts.horas * 60;
    const libres = Array.from({ length: opts.servidores }, () => 0);
    let reloj = 0;
    while (reloj < fin) {
      reloj += exp(rng, mediaLlegada);
      if (reloj >= fin) break;
      libres.sort((a, b) => a - b);
      const inicio = Math.max(reloj, libres[0]);
      const espera = inicio - reloj;
      if (espera > paciencia) {
        abandonos++;
        continue;
      }
      esperas.push(espera);
      atendidos++;
      libres[0] = inicio + exp(rng, opts.servicioMin);
    }
  }
  esperas.sort((a, b) => a - b);
  const media = esperas.length ? esperas.reduce((s, x) => s + x, 0) / esperas.length : 0;
  const p90 = esperas.length ? esperas[Math.min(esperas.length - 1, Math.floor(esperas.length * 0.9))] : 0;
  return { replicas: opts.replicas, esperaMediaMin: media, esperaP90Min: p90, abandono: abandonos, atendidos };
}
