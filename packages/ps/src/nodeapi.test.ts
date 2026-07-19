import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

  const realNodeapiPath = getBinaryPath("dotnet-nodeapi");
  if (!realNodeapiPath) {
    t.skip("dotnet-nodeapi assembly not built");
    return;
  }

  if (!getBinaryPath("dotnet")) {
    t.skip("dotnet CLI binary not built");
    return;
  }

  const testDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "sysutils-ps-nodeapi-test-"),
  );
  const testBinaryPath = path.join(testDir, "ps-nodeapi.dll");
  fs.copyFileSync(realNodeapiPath, testBinaryPath);
  process.env.SYSUTILS_PS_TEST_NODEAPI_PATH = testBinaryPath;

  function cleanup() {
    delete process.env.SYSUTILS_PS_TEST_NODEAPI_PATH;
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }

  function setTestBinary(content?: Buffer) {
    if (content === undefined) {
      if (fs.existsSync(testBinaryPath)) fs.rmSync(testBinaryPath);
    } else {
      fs.writeFileSync(testBinaryPath, content);
    }
  }

  try {
    // 1. Env-selected nodeapi with a missing assembly falls back to the dotnet CLI.
    setTestBinary(undefined);
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
      setTestBinary(fs.readFileSync(realNodeapiPath));
    }

    // 2. Env-selected nodeapi with a corrupt/invalid assembly falls back to the dotnet CLI.
    setTestBinary(Buffer.from("not a valid .NET assembly"));
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
      setTestBinary(fs.readFileSync(realNodeapiPath));
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
    cleanup();
    process.exit(1);
  }

  cleanup();
  process.exit(0);
});
