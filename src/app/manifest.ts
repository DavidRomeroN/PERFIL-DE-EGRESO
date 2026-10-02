import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TurnoYa — Fila virtual y turnos",
    short_name: "TurnoYa",
    description: "Toma tu turno con un QR y recibe un aviso por WhatsApp cuando falte poco.",
    start_url: "/",
    display: "standalone",
    background_color: "#f8fafb",
    theme_color: "#0f766e",
    lang: "es-PE",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
