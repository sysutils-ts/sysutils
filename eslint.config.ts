import tseslint from "typescript-eslint";

export default tseslint.config(
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
    files: ["**/*.ts", "**/*.js", "**/*.mjs"],
    extends: tseslint.configs.recommended,
  },
);
