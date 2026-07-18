import assert from "node:assert";
import fs from "node:fs";
import test from "node:test";
import { getBinaryPath, listProcesses } from "./index.js";

test("dotnet-nodeapi selection, fallback, and explicit execution", async (t) => {
  // node-api-dotnet 0.9.21 has an open shutdown bug on Node >= 24.14.0 that can
  // keep the .NET host alive after the test completes. This test file exits
  // explicitly below so the test runner is not blocked.
  if (process.env.SYSUTILS_PS_TEST_NODEAPI !== "1") {
    t.skip("SYSUTILS_PS_TEST_NODEAPI is not set");
    return;
  }

  const nodeapiPath = getBinaryPath("dotnet-nodeapi");
  if (!nodeapiPath) {
    t.skip("dotnet-nodeapi assembly not built");
    return;
  }

  const dotnetPath = getBinaryPath("dotnet");
  if (!dotnetPath) {
    t.skip("dotnet CLI binary not built");
    return;
  }

  const backup = `${nodeapiPath}.tmp`;

  function restoreAssembly() {
    if (!nodeapiPath) return;
    try {
      if (fs.existsSync(backup) && !fs.existsSync(nodeapiPath)) {
        fs.renameSync(backup, nodeapiPath);
      } else if (fs.existsSync(nodeapiPath) && fs.statSync(nodeapiPath).size < 1024) {
        // A dummy/placeholder file was left in place; replace it with the backup.
        fs.rmSync(nodeapiPath);
        fs.renameSync(backup, nodeapiPath);
      }
    } catch {
      // best effort
    }
  }

  try {
    // 1. Env-selected nodeapi with a missing assembly falls back to the dotnet CLI.
    fs.renameSync(nodeapiPath, backup);
    process.env.SYSUTILS_PS_BACKEND = "dotnet-nodeapi";
    try {
      const missing = await listProcesses({ fields: ["pid", "name"] });
      assert.ok(missing.length > 0);
      assert.ok(
        missing.every(
          (p) => typeof p.pid === "number" && typeof p.name === "string",
        ),
      );
    } finally {
      delete process.env.SYSUTILS_PS_BACKEND;
      restoreAssembly();
    }

    // 2. Env-selected nodeapi with a corrupt/invalid assembly falls back to the dotnet CLI.
    fs.renameSync(nodeapiPath, backup);
    fs.writeFileSync(nodeapiPath, "not a valid .NET assembly");
    process.env.SYSUTILS_PS_BACKEND = "dotnet-nodeapi";
    try {
      const corrupt = await listProcesses({ fields: ["pid", "name"] });
      assert.ok(corrupt.length > 0);
      assert.ok(
        corrupt.every(
          (p) => typeof p.pid === "number" && typeof p.name === "string",
        ),
      );
    } finally {
      delete process.env.SYSUTILS_PS_BACKEND;
      restoreAssembly();
    }

    // 3. Explicit dotnet-nodeapi backend executes successfully when the assembly is valid.
    const explicit = await listProcesses({
      backend: "dotnet-nodeapi",
      fields: ["pid", "name"],
    });
    assert.ok(explicit.length > 0);
    assert.ok(
      explicit.every(
        (p) => typeof p.pid === "number" && typeof p.name === "string",
      ),
    );
  } catch (err) {
    console.error(err);
    process.exit(1);
  }

  process.exit(0);
});
