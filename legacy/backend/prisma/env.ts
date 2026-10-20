// Carga el .env de la raíz del monorepo (lo comparte el frontend); un backend/.env tiene prioridad.
// Se importa primero en los seeds, en lugar de "dotenv/config", que solo mira el directorio actual.
import { config } from "dotenv";

config({ path: [".env", "../.env"], quiet: true });
