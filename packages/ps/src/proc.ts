import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { Readable } from "node:stream";
import {
  normalizeProcessInfo,
  toBackendFields,
  type ProcessStream,
} from "./types.js";

export function procBackendAvailable(): boolean {
  return (
    process.platform === "linux" &&
    existsSync("/proc") &&
    existsSync("/proc/self/stat")
  );
}

interface ProcStat {
  ppid: number;
  utime: number;
  stime: number;
  startTime: number;
  rss: number;
}

interface SystemInfo {
  pageSize: number;
  ticks: number;
  uptime: number;
  bootTime: number;
  totalMem: number;
}

interface ProcRead {
  pid: number;
  ppid: number;
  uid: number | null;
  name: string;
  cmd: string | null;
  path: string | null;
  startTime: number | null;
  memory: number | null;
  cpu: number | null;
}

let clockTicksCache: number | undefined;
let pageSizeCache: number | undefined;

function getClockTicks(): number {
  if (clockTicksCache !== undefined) return clockTicksCache;
  try {
    const out = spawnSync("getconf", ["CLK_TCK"], {
      encoding: "utf8",
    }).stdout.trim();
    const n = Number(out);
    if (n > 0) {
      clockTicksCache = n;
      return n;
    }
  } catch {
    // fall through to default
  }
  clockTicksCache = 100;
  return clockTicksCache;
}

function getPageSize(): number {
  if (pageSizeCache !== undefined) return pageSizeCache;
  try {
    const out = spawnSync("getconf", ["PAGESIZE"], {
      encoding: "utf8",
    }).stdout.trim();
    const n = Number(out);
    if (n > 0) {
      pageSizeCache = n;
      return n;
    }
  } catch {
    // fall through to default
  }
  pageSizeCache = 4096;
  return pageSizeCache;
}

function readProcFile(...parts: string[]): Buffer | undefined {
  try {
    return readFileSync(parts.join("/"));
  } catch {
    return undefined;
  }
}

function readExeLink(dir: string): string | null {
  try {
    const target = readlinkSync(`${dir}/exe`);
    let s = target.toString();
    if (s.endsWith(" (deleted)")) {
      s = s.slice(0, -" (deleted)".length);
    }
    return s || null;
  } catch {
    return null;
  }
}

function parseUptime(data: Buffer): number {
  const s = data.toString("utf8").trim();
  const idx = s.indexOf(" ");
  const first = idx >= 0 ? s.slice(0, idx) : s;
  const n = Number(first);
  return Number.isFinite(n) ? n : 0;
}

function parseBtime(data: Buffer): number {
  const str = data.toString("utf8");
  const idx = str.indexOf("btime ");
  if (idx < 0) return 0;
  const start = idx + "btime ".length;
  const end = str.indexOf("\n", start);
  const token = str.slice(start, end < 0 ? undefined : end).trim();
  const n = Number(token);
  return Number.isFinite(n) ? n : 0;
}

function parseMemTotal(data: Buffer): number {
  const str = data.toString("utf8");
  const idx = str.indexOf("MemTotal:");
  if (idx < 0) return 1;
  const start = idx + "MemTotal:".length;
  const end = str.indexOf("\n", start);
  const token = str
    .slice(start, end < 0 ? undefined : end)
    .trim()
    .split(/\s+/)[0];
  const n = Number(token);
  return n > 0 ? n * 1024 : 1;
}

function parseStatusUid(data: Buffer): number | null {
  const str = data.toString("utf8");
  const idx = str.indexOf("Uid:");
  if (idx < 0) return null;
  const start = idx + "Uid:".length;
  const end = str.indexOf("\n", start);
  const line = str.slice(start, end < 0 ? undefined : end).trim();
  const first = line.split(/\s+/)[0];
  const n = Number(first);
  return Number.isFinite(n) ? n : null;
}

function parseStat(data: Buffer): ProcStat | undefined {
  const str = data.toString("utf8");
  const rpar = str.lastIndexOf(")");
  if (rpar < 0 || rpar + 1 >= str.length) return undefined;

  const tokens: string[] = [];
  let i = rpar + 1;
  while (i < str.length) {
    while (i < str.length && str[i] === " ") i++;
    if (i >= str.length) break;
    const start = i;
    while (i < str.length && str[i] !== " ") i++;
    tokens.push(str.slice(start, i));
  }

  if (tokens.length < 22) return undefined;

  const ppid = Number(tokens[1]);
  const utime = Number(tokens[11]);
  const stime = Number(tokens[12]);
  const startTime = Number(tokens[19]);
  const rss = Number(tokens[21]);

  if (![ppid, utime, stime, startTime, rss].every(Number.isFinite)) {
    return undefined;
  }

  return { ppid, utime, stime, startTime, rss };
}

function decodeCmdline(data: Buffer): string | null {
  const s = data.toString("utf8").replace(/\0/g, " ").trim();
  return s.length ? s : null;
}

function decodeComm(data: Buffer): string {
  return data.toString("utf8").trim();
}

function readOneProcess(
  dir: string,
  pid: number,
  wants: Record<string, boolean>,
  sys: SystemInfo,
): ProcRead {
  const wantsName = wants.name || wants.cmd;
  const wantsPath = wants.path;
  const wantsCmd = wants.cmd;
  const wantsUid = wants.uid;
  const wantsPpid = wants.ppid;
  const wantsMemory = wants.memory;
  const wantsCpu = wants.cpu;
  const wantsStartTime = wants.startTime;

  let path: string | null = null;
  let name = "";

  if (wantsName || wantsPath) {
    path = readExeLink(dir);
    if (path) {
      const idx = path.lastIndexOf("/");
      name = idx >= 0 ? path.slice(idx + 1) : path;
    }
    if (!name && wantsName) {
      const commBytes = readProcFile(dir, "comm");
      if (commBytes) name = decodeComm(commBytes);
    }
    if (!name) name = "";
  }

  let cmd: string | null = null;
  if (wantsCmd) {
    const cmdline = readProcFile(dir, "cmdline");
    cmd = cmdline ? decodeCmdline(cmdline) : null;
  }

  let uid: number | null = null;
  if (wantsUid) {
    const status = readProcFile(dir, "status");
    uid = status ? parseStatusUid(status) : null;
  }

  let stat: ProcStat | undefined;
  if (wantsPpid || wantsMemory || wantsCpu || wantsStartTime) {
    const statBytes = readProcFile(dir, "stat");
    stat = statBytes ? parseStat(statBytes) : undefined;
  }

  const ppid = stat ? stat.ppid : 0;

  let startTime: number | null = null;
  if (stat && wantsStartTime) {
    const epoch = sys.bootTime + stat.startTime / sys.ticks;
    startTime = Number.isFinite(epoch) ? epoch : null;
  }

  let memory: number | null = null;
  if (stat && wantsMemory) {
    const value = ((stat.rss * sys.pageSize) / sys.totalMem) * 100.0;
    memory = Number.isFinite(value) ? value : null;
  }

  let cpu: number | null = null;
  if (stat && wantsCpu) {
    const processAge = sys.uptime - stat.startTime / sys.ticks;
    if (processAge > 0) {
      const totalTime = (stat.utime + stat.stime) / sys.ticks;
      const value = (totalTime / processAge) * 100.0;
      cpu = Number.isFinite(value) ? value : null;
    }
  }

  return { pid, ppid, uid, name, cmd, path, startTime, memory, cpu };
}

const ALL_BACKEND_FIELDS = [
  "pid",
  "ppid",
  "uid",
  "name",
  "cmd",
  "path",
  "startTime",
  "memory",
  "cpu",
];

function buildWants(requestedFields?: string[]): Record<string, boolean> {
  const backendFields = toBackendFields(requestedFields);
  const wants: Record<string, boolean> = {};
  for (const f of backendFields ?? ALL_BACKEND_FIELDS) {
    wants[f] = true;
  }
  return wants;
}

async function* generateProcInfos(
  requestedFields?: string[],
): AsyncGenerator<Record<string, unknown>> {
  if (!procBackendAvailable()) {
    throw new Error("The /proc backend is only available on Linux.");
  }

  const wants = buildWants(requestedFields);
  const sys: SystemInfo = {
    pageSize: getPageSize(),
    ticks: getClockTicks(),
    uptime: parseUptime(readProcFile("/proc", "uptime") ?? Buffer.alloc(0)),
    bootTime: parseBtime(readProcFile("/proc", "stat") ?? Buffer.alloc(0)),
    totalMem: parseMemTotal(
      readProcFile("/proc", "meminfo") ?? Buffer.alloc(0),
    ),
  };

  const dirs = readdirSync("/proc").filter((d) => /^\d+$/.test(d));

  for (const pidStr of dirs) {
    const pid = Number(pidStr);
    const dir = `/proc/${pidStr}`;
    const info = readOneProcess(dir, pid, wants, sys);
    const startTimeISO =
      info.startTime !== null
        ? new Date(Math.round(info.startTime * 1000)).toISOString()
        : null;

    const raw: Record<string, unknown> = {
      pid: info.pid,
      ppid: info.ppid,
      uid: info.uid,
      name: info.name,
      cmd: info.cmd,
      path: info.path,
      startTime: startTimeISO,
      memory: info.memory,
      cpu: info.cpu,
    };

    yield normalizeProcessInfo(raw, requestedFields);
  }
}

export function createProcStream(options?: {
  fields?: string[];
  requestedFields?: string[];
}): ProcessStream {
  const stream = Readable.from(generateProcInfos(options?.requestedFields), {
    objectMode: true,
  }) as ProcessStream;
  stream.process = undefined;
  return stream;
}
