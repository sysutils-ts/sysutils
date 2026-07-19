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
  ...tseslint.configs.recommended,
);
