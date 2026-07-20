import assert from "node:assert";
import { existsSync } from "node:fs";
import test from "node:test";
import {
  createProcessStream,
  getBinaryPath,
  listProcesses,
  toProcessRow,
} from "./index.js";

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

test(
  "proc backend lists processes on Linux",
  { skip: process.platform !== "linux" },
  async () => {
    const procs = await listProcesses({
      backend: "proc",
      fields: ["pid", "ppid", "name"],
    });
    assert.ok(procs.length > 0);
    assert.ok(
      procs.every(
        (p) =>
          typeof p.pid === "number" &&
          typeof p.ppid === "number" &&
          typeof p.name === "string",
      ),
    );
  },
);

test(
  "proc backend exposes command, startedAt, and user aliases",
  { skip: process.platform !== "linux" },
  async () => {
    const procs = await listProcesses({
      backend: "proc",
      fields: ["pid", "command", "user", "startedAt"],
    });
    assert.ok(procs.length > 0);
    const first = procs[0];
    assert.strictEqual(typeof first.pid, "number");
    assert.strictEqual(typeof first.command, "string");
    assert.ok(typeof first.startedAt === "number" || first.startedAt === null);
    assert.ok(typeof first.user === "string" || first.user === null);
  },
);

test(
  "auto backend falls back to /proc on Linux when no native binary is built",
  {
    skip: process.platform !== "linux" || getBinaryPath("dotnet") !== undefined,
  },
  async () => {
    const procs = await listProcesses({ fields: ["pid", "name"] });
    assert.ok(procs.length > 0);
    assert.ok(
      procs.every(
        (p) => typeof p.pid === "number" && typeof p.name === "string",
      ),
    );
  },
);

test("toProcessRow normalizes a ProcessInfo into a ProcessRow", () => {
  const row = toProcessRow({
    pid: 1,
    ppid: 0,
    name: "init",
    cmd: "/sbin/init",
    uid: 0,
    startTime: new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.strictEqual(row.pid, 1);
  assert.strictEqual(row.ppid, 0);
  assert.strictEqual(row.command, "/sbin/init");
  assert.strictEqual(row.user, "0");
  assert.strictEqual(
    row.startedAt,
    new Date("2026-01-01T00:00:00.000Z").getTime(),
  );
});

test("toProcessRow falls back to name and uid string", () => {
  const row = toProcessRow({
    pid: 42,
    ppid: 1,
    name: "node",
    uid: 1000,
  });
  assert.strictEqual(row.command, "node");
  assert.strictEqual(row.user, "1000");
  assert.strictEqual(row.startedAt, null);
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
    /Invalid `@sysutils\/ps` backend: "rust"/,
  );
});
