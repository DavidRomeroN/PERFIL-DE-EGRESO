import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// El .env vive en la raíz del repositorio (lo comparten legacy/ y el proyecto Java); un backend/.env tiene prioridad
config({ path: [".env", "../.env", "../../.env"], quiet: true });

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
