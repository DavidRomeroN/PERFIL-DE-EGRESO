import type React from "react";
import { AbsoluteFill, Interactive, interpolate, spring, useCurrentFrame, useVideoConfig, type InteractivitySchema } from "remotion";
import { C, EASE, SANS } from "../marca";
import { Linea, Persona } from "../piezas";

type Props = {
  readonly titulo: string;
  readonly remate: string;
  readonly pregunta: string;
  readonly style?: React.CSSProperties;
};

const COLORES = ["#94a3b8", "#64748b", "#a3b1c2", "#7c8a9c", "#94a3b8", "#6b7a8c", "#a3b1c2", "#7c8a9c"];
// Quién pregunta y en qué cuadro aparece su globo
const PREGUNTAS = [
  { persona: 1, desde: 26 },
  { persona: 4, desde: 52 },
  { persona: 6, desde: 78 },
];

/** Escena 2 · Problema: la fila física, la incertidumbre y el abandono. */
const ProblemaInner: React.FC<Props> = ({ titulo, remate, pregunta, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const salida = interpolate(frame, [120, 175], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });

  return (
    <AbsoluteFill style={{ backgroundColor: C.fondo, fontFamily: SANS, color: C.tinta, ...style }}>
      <div style={{ position: "absolute", left: 140, top: 120, fontSize: 92, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1 }}>
        <Linea retraso={4}>{titulo}</Linea>
        <div
          style={{
            fontSize: 58,
            fontWeight: 700,
            color: C.rosa,
            marginTop: 26,
            opacity: interpolate(frame, [122, 140], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            translate: interpolate(frame, [122, 140], ["0px 20px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }),
          }}
        >
          {remate}
        </div>
      </div>

      {/* La fila */}
      <div style={{ position: "absolute", left: 160, right: 160, bottom: 110, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        {COLORES.map((color, i) => {
          const esUltimo = i === COLORES.length - 1;
          const globo = PREGUNTAS.find((p) => p.persona === i);
          return (
            <div
              key={i}
              style={{
                position: "relative",
                opacity: esUltimo ? 1 - salida : interpolate(frame, [i * 3, i * 3 + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
                translate: esUltimo ? `${salida * 260}px 0` : interpolate(frame, [i * 3, i * 3 + 20], ["0px 40px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }),
              }}
            >
              {globo && (
                <div
                  style={{
                    position: "absolute",
                    bottom: "100%",
                    left: "50%",
                    marginBottom: 20,
                    translate: "-50% 0",
                    whiteSpace: "nowrap",
                    background: C.blanco,
                    borderRadius: 26,
                    padding: "16px 26px",
                    fontSize: 36,
                    fontWeight: 700,
                    boxShadow: "0 18px 40px -18px rgba(4,33,30,.35)",
                    transformOrigin: "bottom center",
                    scale: spring({ frame: frame - globo.desde, fps, config: { damping: 12, stiffness: 180 } }),
                  }}
                >
                  {pregunta}
                </div>
              )}
              <Persona color={esUltimo ? C.rosa : color} alto={esUltimo ? 250 : 230 + (i % 3) * 18} />
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const schema = {
  titulo: { type: "text-content", default: "De pie, sin saber cuánto falta.", description: "Titular" },
  remate: { type: "text-content", default: "Y muchos se van sin ser atendidos.", description: "Remate" },
  pregunta: { type: "text-content", default: "¿Cuánto falta?", description: "Globo de pregunta" },
} as const satisfies InteractivitySchema;

export const Problema = Interactive.withSchema({
  Component: ProblemaInner,
  componentName: "<Problema>",
  schema,
  wrapInSequence: true,
});
