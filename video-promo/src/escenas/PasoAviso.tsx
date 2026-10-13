import type React from "react";
import { Audio } from "@remotion/media";
import { AbsoluteFill, Interactive, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig, type InteractivitySchema } from "remotion";
import { C, EASE, SANS } from "../marca";
import { Telefono, TextoPaso } from "../piezas";

type Props = {
  readonly titulo: string;
  readonly frase: string;
  readonly mensaje: string;
  readonly style?: React.CSSProperties;
};

const LLEGA = 34; // cuadro en que llega el mensaje

/** Escena 6 · Paso 3: el aviso por WhatsApp cuando faltan 2 personas. */
const PasoAvisoInner: React.FC<Props> = ({ titulo, frase, mensaje, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - LLEGA, fps, config: { damping: 13, stiffness: 170 } });
  const leido = frame >= LLEGA + 60;
  // Vibración corta del celular al llegar el aviso
  const vibra = interpolate(frame, [LLEGA, LLEGA + 3, LLEGA + 6, LLEGA + 9, LLEGA + 12, LLEGA + 15], [0, -9, 9, -7, 5, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: C.fondo, fontFamily: SANS, ...style }}>
      <div style={{ position: "absolute", left: 140, top: 0, bottom: 0, display: "flex", alignItems: "center" }}>
        <TextoPaso numero={3} titulo={titulo} frase={frase} />
      </div>

      <div
        style={{
          position: "absolute",
          left: 1290,
          top: 100,
          rotate: `${vibra * 0.4}deg`,
          translate: `${vibra}px 0`,
        }}
      >
        <Telefono>
          <div style={{ position: "absolute", inset: 0, background: C.waFondo }} />
          <div style={{ position: "relative", background: C.waVerde, color: C.blanco, padding: "70px 24px 22px", display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ width: 58, height: 58, borderRadius: 999, background: "rgba(255,255,255,.2)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 26 }}>P</span>
            <span>
              <span style={{ display: "block", fontSize: 24, fontWeight: 700 }}>Policlínico San Román</span>
              <span style={{ display: "block", fontSize: 17, opacity: 0.75 }}>cuenta de empresa</span>
            </span>
          </div>
          <div style={{ position: "relative", padding: 22 }}>
            <div style={{ margin: "0 auto", width: "fit-content", background: "rgba(255,255,255,.8)", borderRadius: 10, padding: "4px 12px", fontSize: 16, color: C.gris }}>HOY</div>
            <div
              style={{
                marginTop: 20,
                maxWidth: 340,
                background: C.blanco,
                borderRadius: "24px 24px 24px 6px",
                padding: "18px 20px",
                fontSize: 25,
                lineHeight: 1.35,
                color: C.tinta,
                boxShadow: "0 6px 16px -10px rgba(0,0,0,.35)",
                transformOrigin: "bottom left",
                scale: pop,
                opacity: interpolate(frame, [LLEGA, LLEGA + 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
              }}
            >
              {mensaje}
              <div style={{ textAlign: "right", fontSize: 16, color: C.gris, marginTop: 8 }}>
                10:42 <span style={{ color: leido ? "#0ea5e9" : "#94a3b8", fontWeight: 800 }}>✓✓</span>
              </div>
            </div>
          </div>
        </Telefono>
        {/* Notificación que asoma sobre el celular */}
        <div
          style={{
            position: "absolute",
            left: -40,
            right: -40,
            top: 40,
            background: C.blanco,
            borderRadius: 28,
            padding: "18px 22px",
            display: "flex",
            gap: 16,
            alignItems: "center",
            boxShadow: "0 30px 60px -24px rgba(4,33,30,.5)",
            opacity: interpolate(frame, [LLEGA - 4, LLEGA + 4, LLEGA + 40, LLEGA + 52], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            translate: interpolate(frame, [LLEGA - 4, LLEGA + 10], ["0px -50px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }),
          }}
        >
          <span style={{ width: 54, height: 54, borderRadius: 16, background: "#25d366", color: C.blanco, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, fontWeight: 800 }}>W</span>
          <span style={{ fontSize: 22, lineHeight: 1.3, color: C.tinta }}>
            <b>Policlínico San Román</b>
            <br />
            Tu turno A-018 está por llegar…
          </span>
        </div>
      </div>

      <Sequence name="Sonido · notificación" from={LLEGA} durationInFrames={40} premountFor={fps}>
        <Audio src="https://remotion.media/snapchat-notification.wav" volume={0.3} />
      </Sequence>
    </AbsoluteFill>
  );
};

const schema = {
  titulo: { type: "text-content", default: "Te avisamos", description: "Título del paso" },
  frase: { type: "text-content", default: "Un WhatsApp te avisa cuando faltan 2 personas. Llegas justo a tiempo.", description: "Frase de apoyo" },
  mensaje: { type: "text-content", default: "Hola María 👋, tu turno A-018 está por llegar: faltan 2 personas. Acércate a la sala.", description: "Mensaje de WhatsApp" },
} as const satisfies InteractivitySchema;

export const PasoAviso = Interactive.withSchema({
  Component: PasoAvisoInner,
  componentName: "<PasoAviso>",
  schema,
  wrapInSequence: true,
});
