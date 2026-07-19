import assert from "node:assert";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { getBinaryPath } from "./index.js";

const packageDir = path.resolve(import.meta.dirname, "..");
const binary = path.join(packageDir, "scripts", "benchmark.ts");

function run(args: string[]) {
  return spawnSync(process.execPath, [binary, ...args], {
    cwd: packageDir,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
}

test("benchmark CLI rejects --runs 0", () => {
  const result = run(["--runs", "0"]);
  assert.notStrictEqual(result.status, 0, "expected non-zero exit code");
  assert.ok(
    result.stderr.includes("positive integer"),
    `stderr should mention positive integer: ${result.stderr}`,
  );
});

test("benchmark CLI rejects --warmup -1", () => {
  const result = run(["--warmup", "-1"]);
  assert.notStrictEqual(result.status, 0, "expected non-zero exit code");
  assert.ok(
    result.stderr.includes("non-negative integer"),
    `stderr should mention non-negative integer: ${result.stderr}`,
  );
});

test(
  "benchmark CLI runs one iteration and emits JSON",
  { skip: !getBinaryPath("dotnet") },
  () => {
    const svgPath = path.join(packageDir, "tmp", "bench-test.svg");
    const result = run([
      "--runs",
      "1",
      "--warmup",
      "0",
      "--svg",
      svgPath,
    ]);
    assert.strictEqual(result.status, 0, `expected success: ${result.stderr}`);
    const payload = JSON.parse(result.stdout) as {
      meta: { runs: number; warmup: number; fields: string[] };
      results: { id: string; error?: string }[];
    };
    assert.strictEqual(payload.meta.runs, 1);
    assert.strictEqual(payload.meta.warmup, 0);
    assert.ok(
      payload.results.some((r) => r.id === "dotnet"),
      "expected a dotnet backend result",
    );
    assert.ok(
      payload.results.every((r) => r.id !== "dotnet" || !r.error),
      "dotnet backend should not error",
    );
  },
);
