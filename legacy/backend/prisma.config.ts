import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// El .env vive en la raíz del monorepo (lo comparte el frontend); un backend/.env tiene prioridad
config({ path: [".env", "../.env"], quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
