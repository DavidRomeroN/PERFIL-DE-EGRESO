import type React from "react";
import { AbsoluteFill, Interactive, interpolate, useCurrentFrame, type InteractivitySchema } from "remotion";
import { C, EASE, MONO, SANS } from "../marca";
import { Linea } from "../piezas";

type Props = {
  readonly linea1: string;
  readonly linea2: string;
  readonly style?: React.CSSProperties;
};

/** Escena 1 · Gancho: una pregunta que todos se han hecho y un reloj que no para. */
const GanchoInner: React.FC<Props> = ({ linea1, linea2, style }) => {
  const frame = useCurrentFrame();
  // El reloj corre rápido: de 12 a 47 minutos de espera en 5 segundos
  const total = Math.floor(interpolate(frame, [0, 140], [12 * 60 + 3, 47 * 60 + 12], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");

  return (
    <AbsoluteFill style={{ backgroundColor: C.oscuro, justifyContent: "center", alignItems: "center", fontFamily: SANS, color: C.blanco, ...style }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(circle at 50% 120%, rgba(20,184,166,.35), transparent 60%)",
        }}
      />
      <div
        style={{
          fontFamily: MONO,
          fontWeight: 700,
          fontSize: 76,
          color: C.ambar,
          letterSpacing: "0.04em",
          opacity: interpolate(frame, [0, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          scale: interpolate(frame, [0, 18], [0.9, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }),
        }}
      >
        00:{mm}:{ss}
      </div>
      <h1 style={{ margin: "40px 0 0", textAlign: "center", fontSize: 128, fontWeight: 800, letterSpacing: "-0.045em", lineHeight: 0.98 }}>
        <Linea retraso={14}>{linea1}</Linea>
        <Linea retraso={24} color={C.marcaClara}>
          {linea2}
        </Linea>
      </h1>
    </AbsoluteFill>
  );
};

const schema = {
  linea1: { type: "text-content", default: "¿Cuánto tiempo pasas", description: "Primera línea" },
  linea2: { type: "text-content", default: "haciendo fila?", description: "Segunda línea" },
} as const satisfies InteractivitySchema;

export const Gancho = Interactive.withSchema({
  Component: GanchoInner,
  componentName: "<Gancho>",
  schema,
  wrapInSequence: true,
});
