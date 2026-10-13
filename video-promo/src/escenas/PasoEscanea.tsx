import type React from "react";
import { Audio } from "@remotion/media";
import { AbsoluteFill, Interactive, interpolate, Sequence, useCurrentFrame, useVideoConfig, type InteractivitySchema } from "remotion";
import { C, EASE, MONO, SANS } from "../marca";
import { CabeceraLocal, QrFalso, Telefono, TextoPaso } from "../piezas";

type Props = {
  readonly titulo: string;
  readonly frase: string;
  readonly style?: React.CSSProperties;
};

const SERVICIOS = [
  { letra: "A", nombre: "Medicina General", detalle: "6 en espera · ~ 25 min" },
  { letra: "B", nombre: "Laboratorio", detalle: "3 en espera · ~ 12 min" },
  { letra: "C", nombre: "Admisión y Caja", detalle: "2 en espera · ~ 8 min" },
];

/** Escena 4 · Paso 1: escanear el QR del local y elegir el servicio. */
const PasoEscaneaInner: React.FC<Props> = ({ titulo, frase, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const leido = frame >= 104; // el QR se lee y aparece la página del local
  const toque = interpolate(frame, [150, 168], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: C.fondo, fontFamily: SANS, ...style }}>
      <div style={{ position: "absolute", left: 140, top: 0, bottom: 0, display: "flex", alignItems: "center" }}>
        <TextoPaso numero={1} titulo={titulo} frase={frase} />
      </div>

      {/* Afiche del local con el QR */}
      <div
        style={{
          position: "absolute",
          left: 1000,
          top: 230,
          width: 420,
          padding: 34,
          borderRadius: 34,
          background: C.blanco,
          boxShadow: "0 30px 80px -30px rgba(4,33,30,.4)",
          textAlign: "center",
          rotate: "-5deg",
          opacity: interpolate(frame, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          translate: interpolate(frame, [0, 24], ["0px 60px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }),
        }}
      >
        <div style={{ fontSize: 34, fontWeight: 800, color: C.tinta, lineHeight: 1.1 }}>Toma tu turno con el celular</div>
        <div style={{ marginTop: 26, display: "flex", justifyContent: "center" }}>
          <QrFalso size={300} />
        </div>
        <div style={{ marginTop: 18, fontSize: 24, color: C.gris }}>Escanéalo · sin apps</div>
      </div>

      {/* Celular */}
      <div
        style={{
          position: "absolute",
          left: 1330,
          top: 100,
          rotate: "4deg",
          translate: interpolate(frame, [16, 46], ["520px 0px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }),
        }}
      >
        <Telefono>
          {!leido ? (
            // Visor de la cámara con la línea que escanea
            <div style={{ position: "absolute", inset: 0, background: "#1d2524", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ position: "relative", padding: 22, background: C.blanco, borderRadius: 18 }}>
                <QrFalso size={250} />
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    height: 4,
                    background: C.marcaClara,
                    boxShadow: `0 0 24px 6px ${C.marcaClara}`,
                    top: interpolate(frame, [46, 72, 98], [10, 280, 10], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
                  }}
                />
              </div>
              {[0, 1, 2, 3].map((k) => (
                <div
                  key={k}
                  style={{
                    position: "absolute",
                    width: 70,
                    height: 70,
                    borderColor: C.blanco,
                    borderStyle: "solid",
                    borderWidth: 0,
                    [k < 2 ? "top" : "bottom"]: 250,
                    [k % 2 === 0 ? "left" : "right"]: 60,
                    [k < 2 ? "borderTopWidth" : "borderBottomWidth"]: 6,
                    [k % 2 === 0 ? "borderLeftWidth" : "borderRightWidth"]: 6,
                    borderRadius: 14,
                  }}
                />
              ))}
            </div>
          ) : (
            <div style={{ opacity: interpolate(frame, [104, 116], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
              <CabeceraLocal sobre="Salud" />
              <div style={{ margin: "-26px 18px 0", background: C.blanco, borderRadius: 32, padding: 24, boxShadow: "0 18px 40px -20px rgba(4,33,30,.35)" }}>
                <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em" }}>¿Qué servicio necesitas?</div>
                {SERVICIOS.map((s, i) => (
                  <div
                    key={s.letra}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                      marginTop: 16,
                      padding: 16,
                      borderRadius: 22,
                      border: `2px solid ${i === 0 && toque > 0 ? C.marca : "#e2e9e7"}`,
                      background: i === 0 && toque > 0 ? "#effaf7" : C.blanco,
                      scale: i === 0 ? interpolate(toque, [0, 0.4, 1], [1, 0.96, 1]) : 1,
                      opacity: interpolate(frame, [110 + i * 6, 124 + i * 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
                    }}
                  >
                    <span style={{ width: 60, height: 60, borderRadius: 16, background: C.marca, color: C.blanco, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontWeight: 700, fontSize: 30 }}>
                      {s.letra}
                    </span>
                    <span>
                      <span style={{ display: "block", fontSize: 25, fontWeight: 700 }}>{s.nombre}</span>
                      <span style={{ display: "block", fontSize: 19, color: C.gris }}>{s.detalle}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Destello al leer el código */}
          <div style={{ position: "absolute", inset: 0, background: C.blanco, opacity: interpolate(frame, [98, 104, 116], [0, 0.9, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }} />
          {/* Dedo que toca la primera opción */}
          <div
            style={{
              position: "absolute",
              left: 260,
              top: 420,
              width: 86,
              height: 86,
              borderRadius: 999,
              background: "rgba(15,118,110,.25)",
              border: "3px solid rgba(15,118,110,.6)",
              opacity: interpolate(frame, [140, 150, 175, 190], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
              scale: interpolate(frame, [140, 150, 160], [1.4, 1, 0.85], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            }}
          />
        </Telefono>
      </div>

      <Sequence name="Sonido · lectura del QR" from={100} durationInFrames={30} premountFor={fps}>
        <Audio src="https://remotion.media/shutter-modern.wav" volume={0.35} />
      </Sequence>
      <Sequence name="Sonido · toque" from={150} durationInFrames={20} premountFor={fps}>
        <Audio src="https://remotion.media/mouse-click.wav" volume={0.6} />
      </Sequence>
    </AbsoluteFill>
  );
};

const schema = {
  titulo: { type: "text-content", default: "Escanea el QR", description: "Título del paso" },
  frase: { type: "text-content", default: "Sin descargar apps ni crear cuentas. Eliges el servicio y listo.", description: "Frase de apoyo" },
} as const satisfies InteractivitySchema;

export const PasoEscanea = Interactive.withSchema({
  Component: PasoEscaneaInner,
  componentName: "<PasoEscanea>",
  schema,
  wrapInSequence: true,
});
