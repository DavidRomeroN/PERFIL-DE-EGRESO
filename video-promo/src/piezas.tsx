import type React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, EASE, MONO, SANS } from "./marca";

/** Ícono de TurnoYa: pantalla con líneas y la "cola" de un globo de mensaje. */
export const LogoMark: React.FC<{ size: number; fondo?: string; color?: string }> = ({ size, fondo = C.marca, color = C.blanco }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.3,
      background: fondo,
      color,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: "0 24px 60px -20px rgba(4,33,30,.55)",
    }}
  >
    <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="12" rx="2.5" />
      <path d="M7 9h5M7 13h9" />
      <path d="M8 17v3l3-3" />
    </svg>
  </div>
);

/** Una línea de titular que sube desde detrás de su propia línea base. */
export const Linea: React.FC<{ children: React.ReactNode; retraso: number; color?: string }> = ({ children, retraso, color }) => {
  const frame = useCurrentFrame();
  return (
    <span style={{ display: "block", overflow: "hidden", paddingBottom: "0.08em", marginBottom: "-0.08em" }}>
      <span
        style={{
          display: "block",
          color,
          translate: interpolate(frame, [retraso, retraso + 22], ["0% 110%", "0% 0%"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: EASE,
          }),
        }}
      >
        {children}
      </span>
    </span>
  );
};

/** Marco de celular; la pantalla es el contenido. */
export const Telefono: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div
    style={{
      width: 430,
      height: 880,
      borderRadius: 66,
      background: "#0c1615",
      padding: 14,
      boxShadow: "0 50px 120px -40px rgba(4,33,30,.6), inset 0 0 0 2px #24302f",
      ...style,
    }}
  >
    <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 54, overflow: "hidden", background: C.fondo, fontFamily: SANS, color: C.tinta }}>
      <div style={{ position: "absolute", top: 14, left: "50%", translate: "-50% 0", width: 120, height: 34, borderRadius: 20, background: "#0c1615", zIndex: 5 }} />
      {children}
    </div>
  </div>
);

/** Cabecera verde de las pantallas del cliente (igual que en la app). */
export const CabeceraLocal: React.FC<{ sobre: string }> = ({ sobre }) => (
  <div style={{ background: `linear-gradient(135deg, ${C.marca}, #0a4d48)`, color: C.blanco, padding: "74px 32px 54px" }}>
    <div style={{ fontSize: 17, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.75, fontWeight: 600 }}>{sobre}</div>
    <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>Policlínico San Román</div>
  </div>
);

/** Columna de texto de cada paso: número, título y una frase de apoyo. */
export const TextoPaso: React.FC<{ numero: number; titulo: string; frase: string }> = ({ numero, titulo, frase }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ width: 760, fontFamily: SANS }}>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 16,
          fontSize: 34,
          fontWeight: 700,
          color: C.marca,
          opacity: interpolate(frame, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        <span
          style={{
            width: 64,
            height: 64,
            borderRadius: 999,
            background: C.marca,
            color: C.blanco,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 34,
            scale: spring({ frame, fps, config: { damping: 14, stiffness: 160 } }),
          }}
        >
          {numero}
        </span>
        Paso {numero} de 4
      </div>
      <div style={{ fontSize: 104, fontWeight: 800, letterSpacing: "-0.045em", lineHeight: 0.98, marginTop: 28, color: C.tinta }}>
        <Linea retraso={6}>{titulo}</Linea>
      </div>
      <p
        style={{
          fontSize: 44,
          lineHeight: 1.3,
          color: C.gris,
          marginTop: 30,
          fontWeight: 500,
          opacity: interpolate(frame, [20, 40], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          translate: interpolate(frame, [20, 40], ["0px 24px", "0px 0px"], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE }),
        }}
      >
        {frase}
      </p>
    </div>
  );
};

/** Código de turno en tipografía monoespaciada. */
export const Codigo: React.FC<{ children: string; size: number; color?: string }> = ({ children, size, color = C.marca }) => (
  <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: size, color, letterSpacing: "-0.02em" }}>{children}</span>
);

/** Patrón de QR decorativo, determinista (no codifica nada). */
export const QrFalso: React.FC<{ size: number; color?: string }> = ({ size, color = C.tinta }) => {
  const n = 21;
  const celdas: React.ReactNode[] = [];
  const esOjo = (x: number, y: number) => (x < 7 && y < 7) || (x > n - 8 && y < 7) || (x < 7 && y > n - 8);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (esOjo(x, y)) continue;
      const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      if (v - Math.floor(v) > 0.52) celdas.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} />);
    }
  }
  const ojo = (x: number, y: number) => (
    <g key={`ojo-${x}-${y}`}>
      <rect x={x} y={y} width={7} height={7} rx={1.4} fill={color} />
      <rect x={x + 1} y={y + 1} width={5} height={5} rx={1} fill={C.blanco} />
      <rect x={x + 2} y={y + 2} width={3} height={3} rx={0.6} fill={color} />
    </g>
  );
  return (
    <svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges">
      <g fill={color}>{celdas}</g>
      {ojo(0, 0)}
      {ojo(n - 7, 0)}
      {ojo(0, n - 7)}
    </svg>
  );
};

/** Silueta simple de una persona para la escena de la fila. */
export const Persona: React.FC<{ color: string; alto?: number }> = ({ color, alto = 260 }) => (
  <svg width={alto * 0.42} height={alto} viewBox="0 0 42 100">
    <circle cx="21" cy="14" r="12" fill={color} />
    <rect x="4" y="30" width="34" height="46" rx="14" fill={color} />
    <rect x="9" y="66" width="10" height="34" rx="5" fill={color} />
    <rect x="23" y="66" width="10" height="34" rx="5" fill={color} />
  </svg>
);
