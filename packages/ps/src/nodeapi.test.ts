import assert from "node:assert";
import fs from "node:fs";
import test from "node:test";
import { getBinaryPath, listProcesses } from "./index.js";

test(
  "dotnet-nodeapi works explicitly and falls back to dotnet CLI when the assembly is missing",
  async (t) => {
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

    try {
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

      // Env-selected nodeapi with a missing assembly should fall back to the dotnet CLI.
      if (process.platform !== "win32") {
        const renamed = `${binaryPath}.tmp`;
        fs.renameSync(binaryPath, renamed);
        process.env.SYSUTILS_PS_BACKEND = "dotnet-nodeapi";
        try {
          const fallback = await listProcesses({ fields: ["pid", "name"] });
          assert.ok(fallback.length > 0);
          assert.ok(
            fallback.every(
              (p) => typeof p.pid === "number" && typeof p.name === "string",
            ),
          );
        } finally {
          delete process.env.SYSUTILS_PS_BACKEND;
          fs.renameSync(renamed, binaryPath);
        }
      }
    } catch (err) {
      console.error(err);
      process.exit(1);
    }

    process.exit(0);
  },
);
