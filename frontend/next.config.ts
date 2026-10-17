import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// Monorepo (npm workspaces): la raíz contiene backend/ y frontend/
const raiz = path.resolve(__dirname, "..");

// El .env vive en la raíz y lo comparten frontend y backend (Prisma, seeds, pruebas)
loadEnvConfig(raiz);

const nextConfig: NextConfig = {
  // Imagen Docker mínima (copia solo lo necesario a .next/standalone)
  output: "standalone",
  // El código de servidor vive en ../backend: Turbopack y el trazado de standalone deben ver la raíz
  outputFileTracingRoot: raiz,
  turbopack: {
    root: raiz,
  },
  // El cliente Prisma generado y el driver pg deben quedar fuera del bundle del servidor
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg", "bcryptjs", "nodemailer", "pdf-lib"],
  poweredByHeader: false,
  async headers() {
    return [
      // M5: el service worker del kiosco vive en /kiosco/sw.js pero controla /kiosco (alcance mínimo, D2)
      { source: "/kiosco/sw.js", headers: [{ key: "Service-Worker-Allowed", value: "/kiosco" }, { key: "Cache-Control", value: "no-cache" }] },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // F7: la cámara solo se usa en el kiosco (escaneo de QR de citas)
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
          ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "img-src 'self' data: blob: https:",
              "style-src 'self' 'unsafe-inline'",
              `script-src 'self' 'unsafe-inline' https://sdk.mercadopago.com https://*.mercadopago.com https://*.mlstatic.com https://*.mercadolibre.com${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
              "connect-src 'self' https://api.mercadopago.com https://*.mercadopago.com https://*.mercadolibre.com https://*.mlstatic.com",
              "frame-src 'self' https://*.mercadopago.com https://*.mercadolibre.com https://*.mercadopago.com.pe",
              "font-src 'self' data:",
              "worker-src 'self' blob:",
              "frame-ancestors 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
