// Carga el .env de la raíz del repositorio (lo comparten legacy/ y el proyecto Java); un backend/.env tiene prioridad.
// Se importa primero en los seeds, en lugar de "dotenv/config", que solo mira el directorio actual.
import { config } from "dotenv";

config({ path: [".env", "../.env", "../../.env"], quiet: true });
