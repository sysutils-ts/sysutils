/**
 * Codacy's ESLint 8 analysis uses its own default plugin set, which is
 * incompatible with this package's target of ESNext/Node.js. The project is
 * linted by ESLint 9 via the root eslint.config.ts. This shim disables all
 * ESLint 8 rules for Codacy so it only relies on the repository's primary
 * linting pipeline.
 */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  rules: {},
};
