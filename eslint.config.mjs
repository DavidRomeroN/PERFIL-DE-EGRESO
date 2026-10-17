import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Monorepo: la app Next vive en frontend/
    settings: { next: { rootDir: "frontend/" } },
    rules: {
      // Patrón "cargar datos al montar" (fetch + setState dentro de useEffect) es intencional en este proyecto.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    "**/.next/**",
    "**/out/**",
    "**/build/**",
    "**/next-env.d.ts",
    "backend/src/generated/**",
    // Proyecto de video (Remotion) con su propia configuración
    "video-promo/**",
  ]),
]);

export default eslintConfig;
