// Crea (si falta) la BD de pruebas y le aplica las migraciones.
//   TEST_DATABASE_URL=postgresql://turnoya:turnoya@localhost:5432/turnoya_test  npm run db:test:prepare
import { execSync } from "node:child_process";
import pg from "pg";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://turnoya:turnoya@localhost:5432/turnoya_test?schema=public";
const u = new URL(url);
const nombre = u.pathname.slice(1);
const admin = new URL(url);
admin.pathname = "/postgres";
admin.search = "";
const c = new pg.Client({ connectionString: admin.toString() });
await c.connect();
const existe = await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [nombre]);
if (!existe.rowCount) await c.query(`CREATE DATABASE "${nombre.replace(/"/g, "")}"`);
await c.end();
execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
console.log(`BD de pruebas lista: ${nombre}`);
