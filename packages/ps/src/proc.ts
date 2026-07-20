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

const GETCONF_PATHS = ["/usr/bin/getconf", "/bin/getconf"];

function getGetconfValue(name: string): number | undefined {
  for (const bin of GETCONF_PATHS) {
    if (!existsSync(bin)) continue;
    try {
      const out = spawnSync(bin, [name], {
        encoding: "utf8",
        env: {},
      }).stdout.trim();
      const n = Number(out);
      if (n > 0) return n;
    } catch {
      // fall through to the next candidate
    }
  }
  return undefined;
}

function getClockTicks(): number {
  clockTicksCache ??= getGetconfValue("CLK_TCK") ?? 100;
  return clockTicksCache;
}

function getPageSize(): number {
  pageSizeCache ??= getGetconfValue("PAGESIZE") ?? 4096;
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
    const deleted = " (deleted)";
    if (s.endsWith(deleted)) {
      s = s.slice(0, -deleted.length);
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

  const tokens = str.slice(rpar + 1).trim().split(/\s+/);
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

// replaceAll is supported in Node >=15; repository engines require Node >=24.
function decodeCmdline(data: Buffer): string | null {
  // nosemgrep
  const s = data.toString("utf8").replaceAll("\0", " ").trim();
  return s.length ? s : null;
}

function decodeComm(data: Buffer): string {
  return data.toString("utf8").trim();
}

function readProcessNameAndPath(
  dir: string,
  wantsName: boolean,
  wantsPath: boolean,
): { name: string; path: string | null } {
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

  return { name, path };
}

function readProcessCmd(dir: string): string | null {
  const cmdline = readProcFile(dir, "cmdline");
  return cmdline ? decodeCmdline(cmdline) : null;
}

function readProcessUid(dir: string): number | null {
  const status = readProcFile(dir, "status");
  return status ? parseStatusUid(status) : null;
}

function readProcessStat(dir: string): ProcStat | undefined {
  const statBytes = readProcFile(dir, "stat");
  return statBytes ? parseStat(statBytes) : undefined;
}

function computeStartTime(
  stat: ProcStat | undefined,
  sys: SystemInfo,
  wants: boolean,
): number | null {
  if (!stat || !wants) return null;
  const epoch = sys.bootTime + stat.startTime / sys.ticks;
  return Number.isFinite(epoch) ? epoch : null;
}

function computeMemory(
  stat: ProcStat | undefined,
  sys: SystemInfo,
  wants: boolean,
): number | null {
  if (!stat || !wants) return null;
  const value = ((stat.rss * sys.pageSize) / sys.totalMem) * 100.0;
  return Number.isFinite(value) ? value : null;
}

function computeCpu(
  stat: ProcStat | undefined,
  sys: SystemInfo,
  wants: boolean,
): number | null {
  if (!stat || !wants) return null;
  const processAge = sys.uptime - stat.startTime / sys.ticks;
  if (processAge <= 0) return null;
  const totalTime = (stat.utime + stat.stime) / sys.ticks;
  const value = (totalTime / processAge) * 100.0;
  return Number.isFinite(value) ? value : null;
}

function readOneProcess(
  dir: string,
  pid: number,
  wants: Record<string, boolean>,
  sys: SystemInfo,
): ProcRead {
  const { name, path } = readProcessNameAndPath(dir, wants.name, wants.path);
  const cmd = wants.cmd ? readProcessCmd(dir) : null;
  const uid = wants.uid ? readProcessUid(dir) : null;
  const wantsStat = wants.ppid || wants.memory || wants.cpu || wants.startTime;
  const stat = wantsStat ? readProcessStat(dir) : undefined;
  const ppid = stat ? stat.ppid : 0;
  const startTime = computeStartTime(stat, sys, wants.startTime);
  const memory = computeMemory(stat, sys, wants.memory);
  const cpu = computeCpu(stat, sys, wants.cpu);

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
