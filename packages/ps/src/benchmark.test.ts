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
    result.stderr.includes("at least 1"),
    `stderr should mention minimum value: ${result.stderr}`,
  );
});

test("benchmark CLI rejects --warmup -1", () => {
  const result = run(["--warmup", "-1"]);
  assert.notStrictEqual(result.status, 0, "expected non-zero exit code");
  assert.ok(
    result.stderr.includes("must be an integer"),
    `stderr should reject negative integer: ${result.stderr}`,
  );
});

test("benchmark CLI rejects non-numeric --runs", () => {
  const result = run(["--runs", "10x"]);
  assert.notStrictEqual(result.status, 0, "expected non-zero exit code");
  assert.ok(
    result.stderr.includes("must be an integer"),
    `stderr should mention integer requirement: ${result.stderr}`,
  );
});

test("benchmark CLI rejects empty --fields", () => {
  const result = run(["--fields", ",,,"]);
  assert.notStrictEqual(result.status, 0, "expected non-zero exit code");
  assert.ok(
    result.stderr.includes("all entries must be non-empty"),
    `stderr should reject empty field entries: ${result.stderr}`,
  );
});

test("benchmark CLI rejects a valueless --svg flag", () => {
  const result = run(["--runs", "1", "--warmup", "0", "--svg"]);
  assert.notStrictEqual(result.status, 0, "expected non-zero exit code");
  assert.ok(
    result.stderr.includes("Missing value for --svg"),
    `stderr should reject valueless flag: ${result.stderr}`,
  );
});

test("benchmark CLI rejects --svg outside the working directory", () => {
  const escapePath = path.resolve(packageDir, "..", "tmp", "escape.svg");
  const result = run(["--svg", escapePath]);
  assert.notStrictEqual(result.status, 0, "expected non-zero exit code");
  assert.ok(
    result.stderr.includes("inside the current working directory"),
    `stderr should reject escaping path: ${result.stderr}`,
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

test(
  "benchmark CLI includes a ps-list result when --compare is requested",
  { skip: !getBinaryPath("dotnet") && !getBinaryPath("dotnet-nodeapi") },
  () => {
    const result = run(["--runs", "1", "--warmup", "0", "--compare"]);
    assert.strictEqual(result.status, 0, `expected success: ${result.stderr}`);
    const payload = JSON.parse(result.stdout) as {
      results: { id: string; error?: string }[];
    };
    assert.ok(
      payload.results.some((r) => r.id === "ps-list"),
      "expected a ps-list result",
    );
  },
);
