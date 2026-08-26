import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["**/dist/**", "**/node_modules/**", "jsx/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
];
