import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Imagen Docker mínima (copia solo lo necesario a .next/standalone)
  output: "standalone",
  turbopack: {
    root: path.resolve(__dirname),
  },
  // El cliente Prisma generado y el driver pg deben quedar fuera del bundle del servidor
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg", "bcryptjs"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
