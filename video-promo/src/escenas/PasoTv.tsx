import type React from "react";
import { Audio } from "@remotion/media";
import { AbsoluteFill, Interactive, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig, type InteractivitySchema } from "remotion";
import { C, EASE, MONO, SANS } from "../marca";
import { TextoPaso } from "../piezas";

type Props = {
  readonly titulo: string;
  readonly frase: string;
  readonly codigo: string;
  readonly ventanilla: string;
  readonly style?: React.CSSProperties;
};

const LLAMA = 40; // cuadro del llamado

/** Escena 7 · Paso 4: la pantalla TV de la sala llama el número con timbre. */
const PasoTvInner: React.FC<Props> = ({ titulo, frase, codigo, ventanilla, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const brillo = interpolate(frame, [LLAMA, LLAMA + 10, LLAMA + 50], [0, 1, 0.25], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: C.fondo, fontFamily: SANS, ...style }}>
      <div style={{ position: "absolute", left: 140, top: 0, bottom: 0, display: "flex", alignItems: "center" }}>
        <TextoPaso numero={4} titulo={titulo} frase={frase} />
      </div>

      {/* Televisor */}
      <div
        style={{
          position: "absolute",
          left: 960,
          top: 250,
          translate: interpolate(frame, [0, 24], ["0px 80px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }),
          opacity: interpolate(frame, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        <div style={{ width: 820, height: 470, borderRadius: 30, background: "#05090d", padding: 16, boxShadow: `0 50px 110px -40px rgba(4,33,30,.65), 0 0 ${120 * brillo}px ${20 * brillo}px rgba(20,184,166,.45)` }}>
          <div
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              borderRadius: 18,
              overflow: "hidden",
              background: "radial-gradient(ellipse at top, rgba(13,148,136,.6), transparent 70%), #0f172a",
              color: C.blanco,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div style={{ fontSize: 24, letterSpacing: "0.3em", opacity: 0.7, fontWeight: 600 }}>LLAMANDO A</div>
            <div style={{ position: "relative", height: 170, width: "100%", overflow: "hidden" }}>
              {/* Número anterior que sale hacia arriba */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  textAlign: "center",
                  fontFamily: MONO,
                  fontWeight: 700,
                  fontSize: 150,
                  lineHeight: "170px",
                  opacity: interpolate(frame, [LLAMA - 6, LLAMA + 6], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
                  translate: interpolate(frame, [LLAMA - 6, LLAMA + 8], ["0px 0px", "0px -120px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }),
                }}
              >
                A-017
              </div>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  textAlign: "center",
                  fontFamily: MONO,
                  fontWeight: 700,
                  fontSize: 150,
                  lineHeight: "170px",
                  opacity: interpolate(frame, [LLAMA, LLAMA + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
                  translate: interpolate(frame, [LLAMA, LLAMA + 22], ["0px 140px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }),
                }}
              >
                {codigo}
              </div>
            </div>
            <div
              style={{
                marginTop: 14,
                background: C.marcaClara,
                borderRadius: 18,
                padding: "10px 40px",
                fontSize: 50,
                fontWeight: 700,
                scale: spring({ frame: frame - LLAMA - 8, fps, config: { damping: 13, stiffness: 160 } }),
              }}
            >
              {ventanilla}
            </div>
          </div>
        </div>
        {/* Pie del televisor */}
        <div style={{ margin: "0 auto", width: 180, height: 50, background: "linear-gradient(#0b1414, #1f2a29)", clipPath: "polygon(30% 0, 70% 0, 100% 100%, 0 100%)" }} />
      </div>

      <Sequence name="Sonido · timbre" from={LLAMA} durationInFrames={60} premountFor={fps}>
        <Audio src="https://remotion.media/ding.wav" volume={0.35} />
      </Sequence>
    </AbsoluteFill>
  );
};

const schema = {
  titulo: { type: "text-content", default: "Te llaman", description: "Título del paso" },
  frase: { type: "text-content", default: "Tu número aparece en la TV de la sala con timbre, y tu celular vibra.", description: "Frase de apoyo" },
  codigo: { type: "text-content", default: "A-018", description: "Número llamado" },
  ventanilla: { type: "text-content", default: "Consultorio 2", description: "Ventanilla" },
} as const satisfies InteractivitySchema;

export const PasoTv = Interactive.withSchema({
  Component: PasoTvInner,
  componentName: "<PasoTv>",
  schema,
  wrapInSequence: true,
});
