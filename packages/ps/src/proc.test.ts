import assert from "node:assert";
import test from "node:test";
import {
  toBackendFields,
  type ProcessInfo,
  type ProcessStream,
} from "./types.js";
import { createProcStream, procBackendAvailable } from "./proc.js";

async function collect(stream: ProcessStream): Promise<ProcessInfo[]> {
  const result: ProcessInfo[] = [];
  for await (const proc of stream) {
    result.push(proc as ProcessInfo);
  }
  return result;
}

async function withMockedPlatform<T>(
  value: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value, configurable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, "platform", original);
  }
}

test("procBackendAvailable reflects the running platform", () => {
  if (process.platform === "linux") {
    assert.strictEqual(procBackendAvailable(), true);
  } else {
    assert.strictEqual(procBackendAvailable(), false);
  }
});

test("procBackendAvailable returns false when the platform is not linux", async () => {
  const result = await withMockedPlatform("win32", () =>
    procBackendAvailable(),
  );
  assert.strictEqual(result, false);
});

test(
  "createProcStream throws (via async iteration) when the backend is unavailable",
  { skip: process.platform !== "linux" },
  async () => {
    await withMockedPlatform("win32", async () => {
      const stream = createProcStream();
      await assert.rejects(async () => {
        for await (const proc of stream) {
          void proc; // draining the stream should surface the generator's error
        }
      }, /proc backend is only available on Linux/);
    });
  },
);

test(
  "createProcStream never exposes a spawned child process",
  { skip: process.platform !== "linux" },
  () => {
    const stream = createProcStream({ fields: ["pid"] });
    assert.strictEqual(stream.process, undefined);
    stream.destroy();
  },
);

test(
  "createProcStream lists processes with numeric pid and ppid",
  { skip: !procBackendAvailable() },
  async () => {
    const procs = await collect(createProcStream());
    assert.ok(procs.length > 0);
    assert.ok(
      procs.every(
        (p) =>
          Number.isInteger(p.pid) &&
          p.pid > 0 &&
          Number.isInteger(p.ppid) &&
          p.ppid >= 0,
      ),
    );
  },
);

test(
  "createProcStream includes the current process with a matching ppid",
  { skip: !procBackendAvailable() },
  async () => {
    const procs = await collect(createProcStream());
    const self = procs.find((p) => p.pid === process.pid);
    assert.ok(self, "expected to find the current process by pid");
    assert.strictEqual(self!.ppid, process.ppid);
  },
);

test(
  "createProcStream returns the full ProcessInfo shape when no fields are requested",
  { skip: !procBackendAvailable() },
  async () => {
    const procs = await collect(createProcStream());
    assert.ok(procs.length > 0);
    const first = procs[0];
    assert.deepStrictEqual(Object.keys(first).sort(), [
      "cmd",
      "command",
      "cpu",
      "memory",
      "name",
      "path",
      "pid",
      "ppid",
      "startTime",
      "startedAt",
      "uid",
      "user",
    ]);
  },
);

test(
  "createProcStream honors requestedFields, returning only those keys",
  { skip: !procBackendAvailable() },
  async () => {
    const requestedFields = ["pid", "name"];
    const procs = await collect(
      createProcStream({
        fields: toBackendFields(requestedFields),
        requestedFields,
      }),
    );
    assert.ok(procs.length > 0);
    assert.ok(
      procs.every((p) => {
        const keys = Object.keys(p).sort();
        return (
          keys.length === 2 &&
          keys[0] === "name" &&
          keys[1] === "pid" &&
          typeof p.pid === "number" &&
          typeof p.name === "string"
        );
      }),
    );
  },
);

test(
  "createProcStream resolves the command alias field end-to-end",
  { skip: !procBackendAvailable() },
  async () => {
    const requestedFields = ["pid", "command"];
    const procs = await collect(
      createProcStream({
        fields: toBackendFields(requestedFields),
        requestedFields,
      }),
    );
    assert.ok(procs.length > 0);
    const self = procs.find((p) => p.pid === process.pid);
    assert.ok(self);
    assert.deepStrictEqual(Object.keys(self!).sort(), ["command", "pid"]);
    assert.strictEqual(typeof self!.command, "string");
  },
);

test(
  "createProcStream resolves the user alias field from uid",
  { skip: !procBackendAvailable() },
  async () => {
    const requestedFields = ["pid", "user"];
    const procs = await collect(
      createProcStream({
        fields: toBackendFields(requestedFields),
        requestedFields,
      }),
    );
    assert.ok(procs.length > 0);
    const self = procs.find((p) => p.pid === process.pid);
    assert.ok(self);
    if (typeof process.getuid === "function") {
      assert.strictEqual(self!.user, String(process.getuid()));
    } else {
      assert.ok(typeof self!.user === "string" || self!.user === null);
    }
  },
);

test(
  "createProcStream resolves the startedAt alias field from startTime",
  { skip: !procBackendAvailable() },
  async () => {
    const requestedFields = ["pid", "startedAt"];
    const procs = await collect(
      createProcStream({
        fields: toBackendFields(requestedFields),
        requestedFields,
      }),
    );
    assert.ok(procs.length > 0);
    const self = procs.find((p) => p.pid === process.pid);
    assert.ok(self);
    assert.ok(
      typeof self!.startedAt === "number" || self!.startedAt === null,
    );
    if (typeof self!.startedAt === "number") {
      assert.ok(self!.startedAt <= Date.now());
    }
  },
);

test(
  "createProcStream yields each pid at most once",
  { skip: !procBackendAvailable() },
  async () => {
    const procs = await collect(createProcStream({ fields: ["pid"] }));
    const pids = procs.map((p) => p.pid);
    assert.strictEqual(pids.length, new Set(pids).size);
  },
);