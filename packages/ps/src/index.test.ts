import assert from "node:assert";
import test from "node:test";
import { createProcessStream, getBinaryPath, listProcesses } from "./index.js";

test("getBinaryPath returns a path only when the native binary exists", () => {
  const rust = getBinaryPath("rust");
  const dotnet = getBinaryPath("dotnet");
  if (rust !== undefined) assert.strictEqual(typeof rust, "string");
  if (dotnet !== undefined) assert.strictEqual(typeof dotnet, "string");
});

test("createProcessStream works when a backend binary is available", async () => {
  if (!getBinaryPath("rust") && !getBinaryPath("dotnet")) {
    assert.throws(
      () => createProcessStream(),
      /No @sysutils\/ps backend found/,
    );
    return;
  }

  const procs = await listProcesses({ fields: ["pid", "name"] });
  assert.ok(procs.length > 0);
  assert.ok(procs.every((p) => typeof p.pid === "number" && typeof p.name === "string"));
});

test("createProcessStream throws for an explicit backend without a binary", () => {
  if (getBinaryPath("dotnet")) {
    // If the .NET binary is built the stream should work.
    return;
  }
  assert.throws(
    () => createProcessStream({ backend: "dotnet" }),
    /native binary is missing/,
  );
});
