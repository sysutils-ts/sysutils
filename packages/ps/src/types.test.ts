import assert from "node:assert";
import test from "node:test";
import {
  normalizeProcessInfo,
  toBackendFields,
  toProcessRow,
  type ProcessInfo,
} from "./types.js";

test("toBackendFields returns undefined for undefined input", () => {
  assert.strictEqual(toBackendFields(undefined), undefined);
});

test("toBackendFields returns undefined for an empty array", () => {
  assert.strictEqual(toBackendFields([]), undefined);
});

test("toBackendFields passes through fields with no alias requirement", () => {
  assert.deepStrictEqual(toBackendFields(["pid", "ppid", "name"]), [
    "pid",
    "ppid",
    "name",
  ]);
});

test("toBackendFields expands command to cmd and name", () => {
  assert.deepStrictEqual(toBackendFields(["command"]), ["cmd", "name"]);
});

test("toBackendFields expands startedAt to startTime", () => {
  assert.deepStrictEqual(toBackendFields(["startedAt"]), ["startTime"]);
});

test("toBackendFields expands user to uid", () => {
  assert.deepStrictEqual(toBackendFields(["user"]), ["uid"]);
});

test("toBackendFields deduplicates overlapping backend fields", () => {
  assert.deepStrictEqual(toBackendFields(["command", "cmd"]), [
    "cmd",
    "name",
  ]);
});

test("toBackendFields deduplicates repeated aliases", () => {
  assert.deepStrictEqual(toBackendFields(["command", "command"]), [
    "cmd",
    "name",
  ]);
});

test("toBackendFields preserves first-seen order across mixed fields", () => {
  assert.deepStrictEqual(toBackendFields(["pid", "command", "user"]), [
    "pid",
    "cmd",
    "name",
    "uid",
  ]);
});

test("normalizeProcessInfo coerces string pid/ppid to numbers", () => {
  const info = normalizeProcessInfo({ pid: "123", ppid: "1", name: "init" });
  assert.strictEqual(info.pid, 123);
  assert.strictEqual(info.ppid, 1);
});

test("normalizeProcessInfo derives command from cmd when present", () => {
  const info = normalizeProcessInfo({
    pid: 1,
    ppid: 0,
    name: "init",
    cmd: "/sbin/init --flag",
  });
  assert.strictEqual(info.command, "/sbin/init --flag");
});

test("normalizeProcessInfo falls back to name when cmd is null", () => {
  const info = normalizeProcessInfo({
    pid: 1,
    ppid: 0,
    name: "init",
    cmd: null,
  });
  assert.strictEqual(info.command, "init");
});

test("normalizeProcessInfo falls back to name when cmd is empty string", () => {
  const info = normalizeProcessInfo({
    pid: 1,
    ppid: 0,
    name: "init",
    cmd: "",
  });
  assert.strictEqual(info.command, "init");
});

test("normalizeProcessInfo returns null command when both cmd and name are empty", () => {
  const info = normalizeProcessInfo({ pid: 1, ppid: 0, name: "" });
  assert.strictEqual(info.command, null);
});

test("normalizeProcessInfo derives startedAt from an ISO startTime string", () => {
  const iso = "2026-01-01T00:00:00.000Z";
  const info = normalizeProcessInfo({
    pid: 1,
    ppid: 0,
    name: "init",
    startTime: iso,
  });
  assert.ok(info.startTime instanceof Date);
  assert.strictEqual(info.startedAt, new Date(iso).getTime());
});

test("normalizeProcessInfo accepts a Date instance directly for startTime", () => {
  const date = new Date("2026-01-01T00:00:00.000Z");
  const info = normalizeProcessInfo({
    pid: 1,
    ppid: 0,
    name: "init",
    startTime: date,
  });
  assert.strictEqual(info.startTime, date);
  assert.strictEqual(info.startedAt, date.getTime());
});

test("normalizeProcessInfo treats an invalid startTime string as null", () => {
  const info = normalizeProcessInfo({
    pid: 1,
    ppid: 0,
    name: "init",
    startTime: "not-a-date",
  });
  assert.strictEqual(info.startTime, null);
  assert.strictEqual(info.startedAt, null);
});

test("normalizeProcessInfo defaults startTime/startedAt to null when absent", () => {
  const info = normalizeProcessInfo({ pid: 1, ppid: 0, name: "init" });
  assert.strictEqual(info.startTime, null);
  assert.strictEqual(info.startedAt, null);
});

test("normalizeProcessInfo derives user string from a non-negative uid", () => {
  const info = normalizeProcessInfo({ pid: 1, ppid: 0, name: "init", uid: 0 });
  assert.strictEqual(info.user, "0");
});

test("normalizeProcessInfo returns null user for a negative uid", () => {
  const info = normalizeProcessInfo({
    pid: 1,
    ppid: 0,
    name: "init",
    uid: -1,
  });
  assert.strictEqual(info.user, null);
});

test("normalizeProcessInfo returns null user when uid is absent", () => {
  const info = normalizeProcessInfo({ pid: 1, ppid: 0, name: "init" });
  assert.strictEqual(info.uid, null);
  assert.strictEqual(info.user, null);
});

test("normalizeProcessInfo without requestedFields returns the full shape", () => {
  const info = normalizeProcessInfo({ pid: 1, ppid: 0, name: "init" });
  assert.deepStrictEqual(Object.keys(info).sort(), [
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
});

test("normalizeProcessInfo with requestedFields returns only the requested keys", () => {
  const info = normalizeProcessInfo(
    { pid: 1, ppid: 0, name: "init", cmd: "/sbin/init" },
    ["pid", "name"],
  );
  assert.deepStrictEqual(Object.keys(info).sort(), ["name", "pid"]);
  assert.strictEqual(info.pid, 1);
  assert.strictEqual(info.name, "init");
});

test("normalizeProcessInfo resolves command as a requested field using derived value", () => {
  const info = normalizeProcessInfo(
    { pid: 1, ppid: 0, name: "init", cmd: null },
    ["command"],
  );
  assert.deepStrictEqual(Object.keys(info), ["command"]);
  assert.strictEqual(info.command, "init");
});

test("normalizeProcessInfo resolves user and startedAt as requested fields", () => {
  const info = normalizeProcessInfo(
    {
      pid: 1,
      ppid: 0,
      name: "init",
      uid: 42,
      startTime: "2026-01-01T00:00:00.000Z",
    },
    ["user", "startedAt"],
  );
  assert.deepStrictEqual(Object.keys(info).sort(), ["startedAt", "user"]);
  assert.strictEqual(info.user, "42");
  assert.strictEqual(
    info.startedAt,
    new Date("2026-01-01T00:00:00.000Z").getTime(),
  );
});

test("normalizeProcessInfo sets unknown requested fields to null", () => {
  const info = normalizeProcessInfo({ pid: 1, ppid: 0, name: "init" }, [
    "pid",
    "bogus",
  ]);
  assert.strictEqual(info.pid, 1);
  assert.strictEqual(info.bogus, null);
});

test("toProcessRow prefers an explicit command over cmd/name", () => {
  const info: ProcessInfo = {
    pid: 1,
    ppid: 0,
    name: "init",
    cmd: "/sbin/init",
    command: "explicit-command",
  };
  const row = toProcessRow(info);
  assert.strictEqual(row.command, "explicit-command");
});

test("toProcessRow returns null command when name is an empty string", () => {
  const info: ProcessInfo = { pid: 1, ppid: 0, name: "" };
  const row = toProcessRow(info);
  assert.strictEqual(row.command, null);
});

test("toProcessRow prefers an explicit user string over a derived uid", () => {
  const info: ProcessInfo = {
    pid: 1,
    ppid: 0,
    name: "init",
    uid: 0,
    user: "root",
  };
  const row = toProcessRow(info);
  assert.strictEqual(row.user, "root");
});

test("toProcessRow returns null user when neither user nor uid is present", () => {
  const info: ProcessInfo = { pid: 1, ppid: 0, name: "init" };
  const row = toProcessRow(info);
  assert.strictEqual(row.user, null);
});

test("toProcessRow prefers an explicit startedAt over startTime", () => {
  const info: ProcessInfo = {
    pid: 1,
    ppid: 0,
    name: "init",
    startTime: new Date("2020-01-01T00:00:00.000Z"),
    startedAt: 123456,
  };
  const row = toProcessRow(info);
  assert.strictEqual(row.startedAt, 123456);
});

test("toProcessRow derives startedAt from startTime when startedAt is absent", () => {
  const date = new Date("2026-01-01T00:00:00.000Z");
  const info: ProcessInfo = { pid: 1, ppid: 0, name: "init", startTime: date };
  const row = toProcessRow(info);
  assert.strictEqual(row.startedAt, date.getTime());
});

test("toProcessRow preserves extra fields via the spread", () => {
  const info: ProcessInfo = { pid: 1, ppid: 0, name: "init", extra: "value" };
  const row = toProcessRow(info);
  assert.strictEqual(row.extra, "value");
  assert.strictEqual(row.pid, 1);
  assert.strictEqual(row.ppid, 0);
});