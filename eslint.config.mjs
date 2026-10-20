import { createRequire } from "node:module";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const require = createRequire(import.meta.url);

// Next 16 ships its presets as flat configs: FlatCompat (eslintrc) chokes on them.
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // eslint-plugin-react's "detect" calls context.getFilename(), gone in ESLint 10: name the version.
    settings: { react: { version: require("react/package.json").version } },
    rules: {
      // "_" marks what is left unused on purpose: a field dropped from a rest, a parameter a signature needs.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "drizzle/**",
    "next-env.d.ts",
    // Playwright's output: its report is a built app.
    "playwright-report/**",
    "test-results/**",
    "blob-report/**",
  ]),
]);
