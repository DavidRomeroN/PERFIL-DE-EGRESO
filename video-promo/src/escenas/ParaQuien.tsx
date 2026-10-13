import type React from "react";
import { AbsoluteFill, Interactive, interpolate, spring, useCurrentFrame, useVideoConfig, type InteractivitySchema } from "remotion";
import { C, EASE, SANS } from "../marca";
import { Linea } from "../piezas";

type Props = {
  readonly titulo: string;
  readonly subtitulo: string;
  readonly style?: React.CSSProperties;
};

const RUBROS = ["Clínicas y policlínicos", "Laboratorios", "Municipalidades", "Bancos y cajas", "Terminales de buses", "Notarías", "Universidades", "Farmacias", "Oficinas de atención"];

/** Escena 9 · Para quién: cualquier lugar donde la gente espera. */
const ParaQuienInner: React.FC<Props> = ({ titulo, subtitulo, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: C.oscuro, fontFamily: SANS, color: C.blanco, justifyContent: "center", alignItems: "center", ...style }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 50% 0%, rgba(20,184,166,.32), transparent 60%)" }} />
      <div style={{ textAlign: "center", fontSize: 104, fontWeight: 800, letterSpacing: "-0.045em", lineHeight: 1 }}>
        <Linea retraso={2}>{titulo}</Linea>
      </div>
      <p
        style={{
          margin: "28px 0 0",
          fontSize: 46,
          color: "#99f6e4",
          fontWeight: 500,
          opacity: interpolate(frame, [16, 32], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        {subtitulo}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 20, maxWidth: 1500, marginTop: 64 }}>
        {RUBROS.map((r, i) => (
          <span
            key={r}
            style={{
              fontSize: 40,
              fontWeight: 600,
              padding: "18px 34px",
              borderRadius: 999,
              background: "rgba(255,255,255,.08)",
              border: "2px solid rgba(153,246,228,.35)",
              scale: spring({ frame: frame - (26 + i * 5), fps, config: { damping: 14, stiffness: 170 } }),
              translate: interpolate(frame, [26 + i * 5, 46 + i * 5], ["0px 20px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }),
            }}
          >
            {r}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const schema = {
  titulo: { type: "text-content", default: "Para cualquier sala de espera", description: "Titular" },
  subtitulo: { type: "text-content", default: "Si tus clientes esperan, TurnoYa los ordena.", description: "Subtítulo" },
} as const satisfies InteractivitySchema;

export const ParaQuien = Interactive.withSchema({
  Component: ParaQuienInner,
  componentName: "<ParaQuien>",
  schema,
  wrapInSequence: true,
});
