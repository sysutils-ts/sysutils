import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    ignores: [
      "**/dist/",
      "**/node_modules/",
      "**/target/",
      "**/bin/",
      "**/obj/",
      "**/*.cs",
      "**/*.rs",
    ],
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {},
  },
]);
