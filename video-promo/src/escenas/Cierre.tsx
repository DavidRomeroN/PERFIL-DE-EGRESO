import type React from "react";
import { AbsoluteFill, Interactive, interpolate, spring, useCurrentFrame, useVideoConfig, type InteractivitySchema } from "remotion";
import { C, EASE, MONO, SANS } from "../marca";
import { Linea, LogoMark } from "../piezas";

type Props = {
  readonly lema: string;
  readonly llamado: string;
  readonly web: string;
  readonly style?: React.CSSProperties;
};

/** Escena 10 · Cierre: marca, promesa y a dónde ir. */
const CierreInner: React.FC<Props> = ({ lema, llamado, web, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: `linear-gradient(150deg, ${C.marca}, #053d38 75%)`, fontFamily: SANS, color: C.blanco, justifyContent: "center", alignItems: "center", ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 26, scale: spring({ frame, fps, config: { damping: 14, stiffness: 150 } }) }}>
        <LogoMark size={120} fondo={C.blanco} color={C.marca} />
        <span style={{ fontSize: 110, fontWeight: 800, letterSpacing: "-0.05em" }}>
          Turno<span style={{ color: C.menta }}>Ya</span>
        </span>
      </div>
      <div style={{ marginTop: 40, fontSize: 132, fontWeight: 800, letterSpacing: "-0.05em", lineHeight: 1, textAlign: "center" }}>
        <Linea retraso={10}>{lema}</Linea>
      </div>
      <div
        style={{
          marginTop: 56,
          display: "flex",
          alignItems: "center",
          gap: 30,
          opacity: interpolate(frame, [30, 44], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          translate: interpolate(frame, [30, 50], ["0px 30px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }),
        }}
      >
        <span style={{ background: C.blanco, color: C.marca, fontSize: 48, fontWeight: 800, padding: "22px 46px", borderRadius: 26 }}>{llamado}</span>
        <span style={{ fontFamily: MONO, fontSize: 52, fontWeight: 700, color: C.menta }}>{web}</span>
      </div>
    </AbsoluteFill>
  );
};

const schema = {
  lema: { type: "text-content", default: "Espera donde quieras.", description: "Lema final" },
  llamado: { type: "text-content", default: "Empieza gratis hoy", description: "Llamado a la acción" },
  web: { type: "text-content", default: "turnoya.pe", description: "Sitio web" },
} as const satisfies InteractivitySchema;

export const Cierre = Interactive.withSchema({
  Component: CierreInner,
  componentName: "<Cierre>",
  schema,
  wrapInSequence: true,
});
