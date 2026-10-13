import type React from "react";
import { Audio } from "@remotion/media";
import { AbsoluteFill, Interactive, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig, type InteractivitySchema } from "remotion";
import { C, EASE, MONO, SANS } from "../marca";
import { Linea } from "../piezas";

type Props = {
  readonly titulo: string;
  readonly style?: React.CSSProperties;
};

const LLAMADOS = [
  { desde: 0, codigo: "A-019", nombre: "Rosa Mamani" },
  { desde: 70, codigo: "A-020", nombre: "Juan Apaza" },
  { desde: 140, codigo: "A-021", nombre: "Elena Ccama" },
];
const COLA = ["A-020", "A-021", "A-022", "A-023", "A-024"];
const CIFRAS = [
  { valor: 40, antes: "−", despues: " %", texto: "menos tiempo en la sala" },
  { valor: 5, antes: "< ", despues: " %", texto: "de clientes que se van" },
  { valor: 1, antes: "< ", despues: " s", texto: "para llamar en la TV" },
];
const EXTRAS = ["Reportes por hora y por día", "Varias ventanillas y locales", "Datos protegidos · Ley 29733"];

/** Escena 8 · Para el negocio: el panel de ventanilla y lo que gana el local. */
const NegocioInner: React.FC<Props> = ({ titulo, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const actual = [...LLAMADOS].reverse().find((l) => frame >= l.desde) ?? LLAMADOS[0];
  const atendidos = LLAMADOS.filter((l) => frame >= l.desde && l.desde > 0).length;
  // Presión del botón un instante antes de cada llamado
  const presion = LLAMADOS.slice(1).reduce((s, l) => s + interpolate(frame, [l.desde - 8, l.desde - 2, l.desde + 4], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), 0);

  return (
    <AbsoluteFill style={{ backgroundColor: C.fondo, fontFamily: SANS, color: C.tinta, ...style }}>
      <div style={{ position: "absolute", left: 140, top: 100, fontSize: 96, fontWeight: 800, letterSpacing: "-0.045em", lineHeight: 1 }}>
        <Linea retraso={2}>{titulo}</Linea>
      </div>

      {/* Panel de ventanilla */}
      <div
        style={{
          position: "absolute",
          left: 140,
          top: 280,
          width: 760,
          background: C.blanco,
          borderRadius: 36,
          padding: 34,
          boxShadow: "0 40px 90px -40px rgba(4,33,30,.45)",
          opacity: interpolate(frame, [6, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          translate: interpolate(frame, [6, 30], ["0px 60px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }),
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, color: C.gris, fontWeight: 600 }}>
          <span>CONSULTORIO 2 · TURNO ACTUAL</span>
          <span style={{ color: "#15803d", background: "#e3f4e8", borderRadius: 999, padding: "2px 14px" }}>● En vivo</span>
        </div>
        <div style={{ height: 150, overflow: "hidden", marginTop: 10 }}>
          <div
            key={actual.codigo}
            style={{
              translate: interpolate(frame, [actual.desde, actual.desde + 16], ["0px 60px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }),
              opacity: interpolate(frame, [actual.desde, actual.desde + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            }}
          >
            <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 84, color: C.marca }}>{actual.codigo}</span>
            <div style={{ fontSize: 28, fontWeight: 600 }}>{actual.nombre}</div>
          </div>
        </div>
        <div
          style={{
            marginTop: 22,
            borderRadius: 26,
            background: C.marca,
            color: C.blanco,
            padding: "26px 0",
            textAlign: "center",
            fontSize: 40,
            fontWeight: 800,
            scale: 1 - presion * 0.04,
            boxShadow: `0 0 0 ${presion * 14}px rgba(20,184,166,.25)`,
          }}
        >
          Llamar siguiente
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
          {COLA.slice(atendidos).map((c) => (
            <span key={c} style={{ fontFamily: MONO, fontWeight: 700, fontSize: 26, padding: "8px 16px", borderRadius: 14, background: "#eef3f2" }}>
              {c}
            </span>
          ))}
        </div>
      </div>

      {/* Cifras */}
      <div style={{ position: "absolute", left: 1000, top: 270, width: 780, display: "flex", flexDirection: "column", gap: 16 }}>
        {CIFRAS.map((c, k) => {
          const inicio = 30 + k * 18;
          const valor = Math.round(interpolate(frame, [inicio, inicio + 40], [0, c.valor], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }));
          return (
            <div
              key={c.texto}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 26,
                background: C.blanco,
                borderRadius: 30,
                padding: "14px 30px",
                boxShadow: "0 24px 60px -36px rgba(4,33,30,.4)",
                opacity: interpolate(frame, [inicio, inicio + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
                translate: interpolate(frame, [inicio, inicio + 24], ["60px 0px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }),
              }}
            >
              <span style={{ fontSize: 80, fontWeight: 800, letterSpacing: "-0.04em", color: C.marca, minWidth: 230, fontVariantNumeric: "tabular-nums" }}>
                {c.antes}
                {valor}
                {c.despues}
              </span>
              <span style={{ fontSize: 38, fontWeight: 600, color: C.gris }}>{c.texto}</span>
            </div>
          );
        })}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 8 }}>
          {EXTRAS.map((e, k) => (
            <span
              key={e}
              style={{
                fontSize: 26,
                fontWeight: 600,
                padding: "10px 22px",
                borderRadius: 999,
                background: C.menta,
                color: "#115e59",
                scale: spring({ frame: frame - (150 + k * 10), fps, config: { damping: 14, stiffness: 170 } }),
              }}
            >
              {e}
            </span>
          ))}
        </div>

      </div>

      <Sequence name="Sonido · llamar 1" from={62} durationInFrames={20} premountFor={fps}>
        <Audio src="https://remotion.media/switch.wav" volume={0.45} />
      </Sequence>
      <Sequence name="Sonido · llamar 2" from={132} durationInFrames={20} premountFor={fps}>
        <Audio src="https://remotion.media/switch.wav" volume={0.45} />
      </Sequence>
    </AbsoluteFill>
  );
};

const schema = {
  titulo: { type: "text-content", default: "Y tu negocio atiende mejor", description: "Titular" },
} as const satisfies InteractivitySchema;

export const Negocio = Interactive.withSchema({
  Component: NegocioInner,
  componentName: "<Negocio>",
  schema,
  wrapInSequence: true,
});
