import assert from "node:assert";
import { existsSync } from "node:fs";
import test from "node:test";
import { createProcessStream, getBinaryPath, listProcesses } from "./index.js";

test("getBinaryPath returns a path only when the native binary exists", () => {
  const dotnet = getBinaryPath("dotnet");
  const dotnetNodeApi = getBinaryPath("dotnet-nodeapi");
  if (dotnet !== undefined) {
    assert.strictEqual(typeof dotnet, "string");
    assert.ok(existsSync(dotnet), "dotnet binary exists at resolved path");
  }
  if (dotnetNodeApi !== undefined) {
    assert.strictEqual(typeof dotnetNodeApi, "string");
    assert.ok(
      existsSync(dotnetNodeApi),
      "dotnet-nodeapi assembly exists at resolved path",
    );
  }
});

test("createProcessStream works when a backend binary is available", async (t) => {
  const cliBackend = getBinaryPath("dotnet") ? "dotnet" : undefined;
  if (!cliBackend) {
    t.skip("dotnet CLI binary not built");
    return;
  }

  const procs = await listProcesses({
    backend: cliBackend,
    fields: ["pid", "name"],
  });
  assert.ok(procs.length > 0);
  assert.ok(
    procs.every((p) => typeof p.pid === "number" && typeof p.name === "string"),
  );
});

test("createProcessStream throws for an explicit backend without a binary", (t) => {
  if (getBinaryPath("dotnet")) {
    t.skip("dotnet binary is available");
    return;
  }
  assert.throws(
    () => createProcessStream({ backend: "dotnet" }),
    /native binary is missing/,
  );
});

test("createProcessStream throws for an unknown backend", () => {
  assert.throws(
    () => createProcessStream({ backend: "rust" as "dotnet" }),
    /No @sysutils\/ps native backend found/,
  );
});

test("listProcesses works with dotnet-nodeapi when the assembly is available", async (t) => {
  // node-api-dotnet 0.9.21 has an open shutdown bug on Node >= 24.14.0 that can
  // crash or hang the process on exit. Run this test only when explicitly opted in.
  if (process.env.SYSUTILS_PS_TEST_NODEAPI !== "1") {
    t.skip("SYSUTILS_PS_TEST_NODEAPI is not set");
    return;
  }
  if (!getBinaryPath("dotnet-nodeapi")) {
    t.skip("dotnet-nodeapi assembly not built");
    return;
  }
  const procs = await listProcesses({
    backend: "dotnet-nodeapi",
    fields: ["pid", "name"],
  });
  assert.ok(procs.length > 0);
  assert.ok(
    procs.every((p) => typeof p.pid === "number" && typeof p.name === "string"),
  );
});
