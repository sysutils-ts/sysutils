import assert from "node:assert";
import test from "node:test";
import { getBinaryPath, listProcesses } from "./index.js";

test("listProcesses works with dotnet-nodeapi when the assembly is available", async (t) => {
  // node-api-dotnet 0.9.21 has an open shutdown bug on Node >= 24.14.0 that can
  // keep the .NET host alive after the test completes. This test file exits
  // explicitly below so the test runner is not blocked.
  if (process.env.SYSUTILS_PS_TEST_NODEAPI !== "1") {
    t.skip("SYSUTILS_PS_TEST_NODEAPI is not set");
    return;
  }
  const binaryPath = getBinaryPath("dotnet-nodeapi");
  if (!binaryPath) {
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

  // Force a clean exit because node-api-dotnet may keep the .NET host alive.
  process.exit(0);
});
