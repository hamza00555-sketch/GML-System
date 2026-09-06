import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  // jsx/ is ExtendScript (ES3) and is not parseable as modern JS.
  { ignores: ["**/dist/**", "**/node_modules/**", "release/**", "jsx/**", "spikes/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    // tools/ is a plain-Node CLI: it needs Node globals and printing to stdout
    // is the point. Listed last so it wins over the block above.
    files: ["tools/**/*.js"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
    rules: { "no-console": "off" },
  },
];
