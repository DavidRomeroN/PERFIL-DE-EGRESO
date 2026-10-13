import { loadFont } from "@remotion/google-fonts/Geist";
import { loadFont as loadMono } from "@remotion/google-fonts/GeistMono";
import { Easing } from "remotion";

/** Identidad de TurnoYa: las mismas fuentes y el mismo verde azulado que la aplicación. */
export const { fontFamily: SANS } = loadFont("normal", {
  weights: ["500", "600", "700", "800"],
  subsets: ["latin"],
});
export const { fontFamily: MONO } = loadMono("normal", {
  weights: ["600", "700"],
  subsets: ["latin"],
});

export const C = {
  tinta: "#0b1f1e",
  gris: "#5b6b6a",
  fondo: "#f3f7f6",
  blanco: "#ffffff",
  marca: "#0f766e",
  marcaClara: "#14b8a6",
  menta: "#ccfbf1",
  oscuro: "#04211e",
  ambar: "#f59e0b",
  rosa: "#e11d48",
  wa: "#d9fdd3",
  waFondo: "#ece5dd",
  waVerde: "#075e54",
} as const;

/** Salida fuerte: arranca rápido y se asienta suave (la misma curva que usa la app). */
export const EASE = Easing.bezier(0.16, 1, 0.3, 1);
