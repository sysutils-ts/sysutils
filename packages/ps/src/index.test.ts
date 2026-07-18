import assert from "node:assert";
import test from "node:test";
import { createProcessStream, getBinaryPath } from "./index.js";

test("getBinaryPath returns undefined when no native binary is built", () => {
  assert.strictEqual(getBinaryPath("rust"), undefined);
  assert.strictEqual(getBinaryPath("dotnet"), undefined);
});

test("createProcessStream throws when no backend is available", () => {
  assert.throws(
    () => createProcessStream(),
    /No @sysutils\/ps backend found/,
  );
});

test("createProcessStream throws for a missing explicit backend", () => {
  assert.throws(
    () => createProcessStream({ backend: "dotnet" }),
    /native binary is missing/,
  );
});
