import type { ChildProcess } from "node:child_process";
import type { Readable as ReadableStream } from "node:stream";

export interface ProcessInfo {
  pid: number;
  ppid: number;
  name: string;
  uid?: number | null;
  user?: string | null;
  cmd?: string | null;
  command?: string | null;
  path?: string | null;
  startTime?: Date | null;
  startedAt?: number | null;
  cpu?: number | null;
  memory?: number | null;
  [key: string]: unknown;
}

export interface ProcessRow {
  pid: number;
  ppid: number;
  command: string | null;
  user: string | null;
  startedAt: number | null;
  name?: string | null;
  cmd?: string | null;
  uid?: number | null;
  path?: string | null;
  startTime?: Date | null;
  cpu?: number | null;
  memory?: number | null;
  [key: string]: unknown;
}

export interface PsOptions {
  backend?: "dotnet" | "dotnet-nodeapi" | "proc" | "auto";
  fields?: string[];
}

export interface ProcessStream extends ReadableStream {
  process?: ChildProcess;
}

const BACKEND_REQUIREMENTS: Record<string, string[]> = {
  command: ["cmd", "name"],
  startedAt: ["startTime"],
  user: ["uid"],
};

export function toBackendFields(fields?: string[]): string[] | undefined {
  if (!fields || fields.length === 0) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of fields) {
    for (const r of BACKEND_REQUIREMENTS[f] ?? [f]) {
      if (seen.has(r)) continue;
      seen.add(r);
      out.push(r);
    }
  }
  return out;
}

export function normalizeProcessInfo(
  raw: Record<string, unknown>,
  requestedFields?: string[],
): ProcessInfo {
  const pid = typeof raw.pid === "number" ? raw.pid : Number(raw.pid);
  const ppid = typeof raw.ppid === "number" ? raw.ppid : Number(raw.ppid);
  const name = typeof raw.name === "string" ? raw.name : "";

  const uid =
    typeof raw.uid === "number" ? raw.uid : raw.uid === null ? null : null;

  const cmd =
    typeof raw.cmd === "string" ? raw.cmd : raw.cmd === null ? null : null;

  const path =
    typeof raw.path === "string" ? raw.path : raw.path === null ? null : null;

  const memory =
    typeof raw.memory === "number"
      ? raw.memory
      : raw.memory === null
        ? null
        : null;

  const cpu =
    typeof raw.cpu === "number" ? raw.cpu : raw.cpu === null ? null : null;

  let startTime: Date | null = null;
  if (typeof raw.startTime === "string") {
    const d = new Date(raw.startTime);
    if (!Number.isNaN(d.getTime())) startTime = d;
  } else if (raw.startTime instanceof Date) {
    startTime = raw.startTime;
  } else if (raw.startTime === null) {
    startTime = null;
  }

  const command = (cmd && cmd.length > 0 ? cmd : name) || null;
  const startedAt = startTime ? startTime.getTime() : null;
  const user = typeof uid === "number" && uid >= 0 ? String(uid) : null;

  if (!requestedFields || requestedFields.length === 0) {
    return {
      pid,
      ppid,
      name,
      uid,
      user,
      cmd,
      command,
      path,
      startTime,
      startedAt,
      cpu,
      memory,
    };
  }

  const result: Record<string, unknown> = {};
  for (const f of requestedFields) {
    if (f === "pid") result.pid = pid;
    else if (f === "ppid") result.ppid = ppid;
    else if (f === "name") result.name = name;
    else if (f === "uid") result.uid = uid;
    else if (f === "user") result.user = user;
    else if (f === "cmd") result.cmd = cmd;
    else if (f === "command") result.command = command;
    else if (f === "path") result.path = path;
    else if (f === "startTime") result.startTime = startTime;
    else if (f === "startedAt") result.startedAt = startedAt;
    else if (f === "cpu") result.cpu = cpu;
    else if (f === "memory") result.memory = memory;
    else result[f] = null;
  }
  return result as ProcessInfo;
}

export function toProcessRow(info: ProcessInfo): ProcessRow {
  const cmdOrName = info.command || info.cmd || info.name;
  const command =
    typeof cmdOrName === "string" && cmdOrName.length > 0 ? cmdOrName : null;

  const uid = typeof info.uid === "number" ? info.uid : null;
  const user =
    typeof info.user === "string"
      ? info.user
      : uid !== null
        ? String(uid)
        : null;

  const start = info.startTime instanceof Date ? info.startTime : null;
  const startedAt =
    typeof info.startedAt === "number"
      ? info.startedAt
      : start
        ? start.getTime()
        : null;

  return { ...info, command, user, startedAt } as ProcessRow;
}
