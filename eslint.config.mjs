import { createRequire } from "node:module";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const require = createRequire(import.meta.url);

// The layering (docs/middleware-readiness.md §6): the domain under src/server
// never reaches up into the screens' server actions (src/server/actions) or the
// UI (src/components). Aliased or relative, the import is the same one.
const NO_ACTIONS = {
  regex: "^(@/server/actions|(\\.\\.?/)+actions)(/|$)",
  message:
    "src/server must not import the screens' server actions: move what both need into a src/server module, and let the action call it.",
};
const NO_COMPONENTS = {
  regex: "^(@/components|(\\.\\.?/)+components)(/|$)",
  message: "src/server must not import the UI (src/components): a server module lives under src/server.",
};

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
  {
    files: ["src/server/**/*.{ts,tsx}"],
    ignores: ["src/server/actions/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [NO_ACTIONS, NO_COMPONENTS] }] },
  },
  {
    // The actions are the screens' entry: they call into src/server, and may call one another, never the UI.
    files: ["src/server/actions/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { patterns: [NO_COMPONENTS] }] },
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
