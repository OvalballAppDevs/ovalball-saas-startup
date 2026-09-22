import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The React Native app is a separate project with its own compiler, its own rules and its own
    // node_modules. Grading it with eslint-config-next reports Next.js opinions about code that is not
    // Next.js, and buries the website's own findings.
    "apps/**",
  ]),
]);

export default eslintConfig;
