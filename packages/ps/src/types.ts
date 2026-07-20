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

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toDateOrNull(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

interface BaseProcess {
  pid: number;
  ppid: number;
  name: string;
  uid: number | null;
  user: string | null;
  cmd: string | null;
  command: string | null;
  path: string | null;
  startTime: Date | null;
  startedAt: number | null;
  cpu: number | null;
  memory: number | null;
}

function getCommand(cmd: string | null, name: string): string | null {
  if (cmd !== null && cmd.length > 0) return cmd;
  if (name.length > 0) return name;
  return null;
}

function getUser(uid: number | null): string | null {
  if (uid !== null && uid >= 0) return String(uid);
  return null;
}

function getBackendUser(
  raw: Record<string, unknown>,
  uid: number | null,
): string | null {
  const rawUser = toStringOrNull(raw.user);
  if (rawUser !== null && rawUser.length > 0) return rawUser;
  return getUser(uid);
}

function buildBaseProcess(raw: Record<string, unknown>): BaseProcess {
  const pid = typeof raw.pid === "number" ? raw.pid : Number(raw.pid);
  const ppid = typeof raw.ppid === "number" ? raw.ppid : Number(raw.ppid);
  const name = toStringOrNull(raw.name) ?? "";
  const uid = toNumberOrNull(raw.uid);
  const cmd = toStringOrNull(raw.cmd);
  const path = toStringOrNull(raw.path);
  const memory = toNumberOrNull(raw.memory);
  const cpu = toNumberOrNull(raw.cpu);
  const startTime = toDateOrNull(raw.startTime);
  const command = getCommand(cmd, name);
  const startedAt = startTime ? startTime.getTime() : null;
  const user = getBackendUser(raw, uid);

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

export function normalizeProcessInfo(
  raw: Record<string, unknown>,
  requestedFields?: string[],
): ProcessInfo {
  const base = buildBaseProcess(raw);

  if (!requestedFields || requestedFields.length === 0) {
    return base as ProcessInfo;
  }

  const fieldValues: Record<string, unknown> = Object.assign(
    Object.create(null),
    base,
  );
  const result: Record<string, unknown> = Object.create(null);
  for (const f of requestedFields) {
    const value = Object.hasOwn(fieldValues, f) ? fieldValues[f] : null;
    result[f] = value;
  }
  return result as ProcessInfo;
}

function deriveCommand(info: ProcessInfo): string | null {
  let value: string | null | undefined = info.command;
  if (typeof value !== "string" || value.length === 0) value = info.cmd;
  if (typeof value !== "string" || value.length === 0) value = info.name;
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

function deriveUser(info: ProcessInfo): string | null {
  if (typeof info.user === "string" && info.user.length > 0) return info.user;
  if (typeof info.uid === "number" && info.uid >= 0) return String(info.uid);
  return null;
}

function deriveStartedAt(info: ProcessInfo): number | null {
  if (typeof info.startedAt === "number") return info.startedAt;
  if (info.startTime instanceof Date) return info.startTime.getTime();
  return null;
}

export function toProcessRow(info: ProcessInfo): ProcessRow {
  const command = deriveCommand(info);
  const user = deriveUser(info);
  const startedAt = deriveStartedAt(info);
  return { ...info, command, user, startedAt } as ProcessRow;
}
