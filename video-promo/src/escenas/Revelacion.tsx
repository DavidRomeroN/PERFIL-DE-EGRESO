import type React from "react";
import { AbsoluteFill, Interactive, interpolate, spring, useCurrentFrame, useVideoConfig, type InteractivitySchema } from "remotion";
import { C, EASE, SANS } from "../marca";
import { LogoMark } from "../piezas";

type Props = {
  readonly lema: string;
  readonly style?: React.CSSProperties;
};

/** Escena 3 · Presentación: aparece la marca y la promesa en una frase. */
const RevelacionInner: React.FC<Props> = ({ lema, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 13, stiffness: 140 } });

  return (
    <AbsoluteFill style={{ background: `linear-gradient(140deg, ${C.marca}, #064e48 70%)`, justifyContent: "center", alignItems: "center", fontFamily: SANS, color: C.blanco, ...style }}>
      {/* Anillo que se expande detrás del logo */}
      <div
        style={{
          position: "absolute",
          width: 520,
          height: 520,
          borderRadius: 999,
          border: "3px solid rgba(204,251,241,.5)",
          scale: interpolate(frame, [4, 60], [0.4, 2.4], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }),
          opacity: interpolate(frame, [4, 60], [0.9, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
        <div style={{ scale: pop, rotate: `${interpolate(pop, [0, 1], [-14, 0])}deg` }}>
          <LogoMark size={190} fondo={C.blanco} color={C.marca} />
        </div>
        <div
          style={{
            fontSize: 190,
            fontWeight: 800,
            letterSpacing: "-0.05em",
            opacity: interpolate(frame, [10, 26], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            translate: interpolate(frame, [10, 30], ["-40px 0px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }),
          }}
        >
          Turno<span style={{ color: C.menta }}>Ya</span>
        </div>
      </div>
      <p
        style={{
          margin: "48px 0 0",
          fontSize: 66,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          color: C.menta,
          opacity: interpolate(frame, [34, 52], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          translate: interpolate(frame, [34, 56], ["0px 26px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }),
        }}
      >
        {lema}
      </p>
    </AbsoluteFill>
  );
};

const schema = {
  lema: { type: "text-content", default: "Tu fila, ahora en tu celular.", description: "Lema" },
} as const satisfies InteractivitySchema;

export const Revelacion = Interactive.withSchema({
  Component: RevelacionInner,
  componentName: "<Revelacion>",
  schema,
  wrapInSequence: true,
});
