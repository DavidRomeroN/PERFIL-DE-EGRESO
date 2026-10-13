import type React from "react";
import { AbsoluteFill, Interactive, interpolate, spring, useCurrentFrame, useVideoConfig, type InteractivitySchema } from "remotion";
import { C, EASE, SANS } from "../marca";
import { CabeceraLocal, Codigo, Telefono, TextoPaso } from "../piezas";

type Props = {
  readonly titulo: string;
  readonly frase: string;
  readonly style?: React.CSSProperties;
};

// La fila avanza: cada salto es una persona atendida
const SALTOS = [0, 45, 90, 135];
const DELANTE = [5, 4, 3, 2];
const MINUTOS = [25, 20, 15, 10];
const LUGARES = ["En el auto", "En un café", "En casa"];

/** Escena 5 · Paso 2: el cliente ve su posición y el tiempo en vivo, y puede esperar donde quiera. */
const PasoSigueInner: React.FC<Props> = ({ titulo, frase, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const paso = SALTOS.filter((s) => frame >= s + 20).length - 1;
  const i = Math.max(0, paso);
  const ultimoSalto = SALTOS[i] + 20;

  return (
    <AbsoluteFill style={{ backgroundColor: C.fondo, fontFamily: SANS, ...style }}>
      <div style={{ position: "absolute", left: 140, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <TextoPaso numero={2} titulo={titulo} frase={frase} />
        <div style={{ display: "flex", gap: 16, marginTop: 40 }}>
          {LUGARES.map((l, k) => (
            <span
              key={l}
              style={{
                fontSize: 34,
                fontWeight: 600,
                padding: "14px 26px",
                borderRadius: 999,
                background: C.menta,
                color: "#115e59",
                scale: spring({ frame: frame - (60 + k * 10), fps, config: { damping: 14, stiffness: 170 } }),
              }}
            >
              {l}
            </span>
          ))}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 1290,
          top: 100,
          translate: interpolate(frame, [0, 26], ["0px 140px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }),
          opacity: interpolate(frame, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        <Telefono>
          <CabeceraLocal sobre="Tu turno en" />
          <div style={{ margin: "-26px 18px 0", background: C.blanco, borderRadius: 32, padding: "26px 24px", textAlign: "center", boxShadow: "0 18px 40px -20px rgba(4,33,30,.35)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22 }}>
              <span style={{ color: C.gris }}>Medicina General</span>
              <span style={{ background: "#eef1f4", color: "#475569", fontWeight: 700, borderRadius: 10, padding: "3px 12px" }}>En espera</span>
            </div>
            <div style={{ fontSize: 18, letterSpacing: "0.2em", color: C.gris, marginTop: 24 }}>TU NÚMERO</div>
            <div style={{ whiteSpace: "nowrap" }}>
              <Codigo size={92}>A-018</Codigo>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 18 }}>
              {[
                { etiqueta: "Delante de ti", valor: DELANTE[i], unidad: "personas" },
                { etiqueta: "Espera aprox.", valor: MINUTOS[i], unidad: "minutos" },
              ].map((d) => (
                <div key={d.etiqueta} style={{ background: "#eef3f2", borderRadius: 22, padding: "16px 8px" }}>
                  <div style={{ fontSize: 19, color: C.gris }}>{d.etiqueta}</div>
                  <div style={{ overflow: "hidden", height: 74 }}>
                    <div
                      key={d.valor}
                      style={{
                        fontSize: 66,
                        fontWeight: 800,
                        lineHeight: "74px",
                        translate: interpolate(frame, [ultimoSalto, ultimoSalto + 14], ["0px -70px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }),
                      }}
                    >
                      {d.valor}
                    </div>
                  </div>
                  <div style={{ fontSize: 19, color: C.gris }}>{d.unidad}</div>
                </div>
              ))}
            </div>
            <div style={{ height: 14, borderRadius: 9, background: "#e5ecea", marginTop: 24, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  borderRadius: 9,
                  background: `linear-gradient(90deg, ${C.marcaClara}, ${C.marca})`,
                  width: `${interpolate(frame, [0, 20, 65, 110, 155], [8, 22, 40, 58, 76], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE })}%`,
                }}
              />
            </div>
            <div style={{ fontSize: 19, color: C.gris, marginTop: 14 }}>Puedes salir: te avisamos cuando falten 2.</div>
          </div>
        </Telefono>
      </div>
    </AbsoluteFill>
  );
};

const schema = {
  titulo: { type: "text-content", default: "Sigue tu turno", description: "Título del paso" },
  frase: { type: "text-content", default: "Ves en vivo cuántas personas faltan y cuánto tardará.", description: "Frase de apoyo" },
} as const satisfies InteractivitySchema;

export const PasoSigue = Interactive.withSchema({
  Component: PasoSigueInner,
  componentName: "<PasoSigue>",
  schema,
  wrapInSequence: true,
});
