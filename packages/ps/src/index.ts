import {
  spawn,
  type ChildProcess,
  type ChildProcessByStdio,
} from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import type { Readable as ReadableStream } from "node:stream";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

let cachedDotnetAddon:
  { PsModule: { listProcesses: (fields: string) => string } } | undefined;

export interface ProcessInfo {
  pid: number;
  ppid: number;
  uid?: number;
  name: string;
  cmd?: string;
  path?: string;
  startTime?: Date;
  cpu?: number;
  memory?: number;
  [key: string]: unknown;
}

export interface PsOptions {
  backend?: "dotnet" | "dotnet-nodeapi" | "auto";
  fields?: string[];
}

type SupportedBackend = "dotnet" | "dotnet-nodeapi";

export interface ProcessStream extends ReadableStream {
  process: ChildProcess;
}

function backendFromEnv(): SupportedBackend | undefined {
  const env = process.env.SYSUTILS_PS_BACKEND;
  if (env === "dotnet" || env === "dotnet-nodeapi") return env;
  return undefined;
}

type BinariesMap = Record<SupportedBackend, Record<string, string>>;

function readBinariesMap(): BinariesMap | undefined {
  try {
    const binariesUrl = new URL("../binaries.json", import.meta.url);
    return JSON.parse(
      readFileSync(fileURLToPath(binariesUrl), "utf8"),
    ) as BinariesMap;
  } catch {
    return undefined;
  }
}

function nodeApiDotNetAvailable(): boolean {
  try {
    require.resolve("node-api-dotnet/net8.0");
    return true;
  } catch {
    return false;
  }
}

export function getBinaryPath(
  backend: SupportedBackend = "dotnet",
): string | undefined {
  const binaries = readBinariesMap();
  if (!binaries) return undefined;

  const backendBinaries = binaries[backend];
  if (!backendBinaries) return undefined;

  const key = `${process.platform}-${process.arch}`;
  const rel = backendBinaries[key];
  if (!rel) return undefined;

  try {
    const binaryUrl = new URL(`../${rel}`, import.meta.url);
    const binaryPath = fileURLToPath(binaryUrl);
    if (!existsSync(binaryPath)) return undefined;
    if (backend === "dotnet-nodeapi" && !nodeApiDotNetAvailable())
      return undefined;
    return binaryPath;
  } catch {
    return undefined;
  }
}

function resolveBackend(
  options?: PsOptions,
  allowNodeapi = true,
): SupportedBackend {
  const requested = options?.backend ?? backendFromEnv() ?? "auto";
  if (requested !== "auto") {
    if (requested !== "dotnet" && requested !== "dotnet-nodeapi") {
      throw new Error(
        "No @sysutils/ps native backend found. Run `npm run build` in @sysutils/ps (or install a prebuilt binary).",
      );
    }
    return requested;
  }
  const order: SupportedBackend[] = allowNodeapi
    ? ["dotnet", "dotnet-nodeapi"]
    : ["dotnet"];
  for (const backend of order) {
    if (getBinaryPath(backend)) return backend;
  }
  throw new Error(
    "No @sysutils/ps native backend found. Run `npm run build` in @sysutils/ps (or install a prebuilt binary).",
  );
}

function normalizeProcessInfo(obj: Record<string, unknown>): ProcessInfo {
  if (typeof obj.startTime === "string") {
    const d = new Date(obj.startTime as string);
    if (!Number.isNaN(d.getTime())) obj.startTime = d;
  }
  return obj as ProcessInfo;
}

export function createProcessStream(options?: PsOptions): ProcessStream {
  let backend = resolveBackend(options, false);
  if (backend === "dotnet-nodeapi") {
    // node-api-dotnet is in-process and synchronous; streaming requires the CLI backend.
    if (getBinaryPath("dotnet")) {
      backend = "dotnet";
    } else {
      throw new Error(
        `Backend "dotnet-nodeapi" does not support streaming and the dotnet CLI binary is not available. Run \`npm run build:cli\` in @sysutils/ps.`,
      );
    }
  }
  const binaryPath = getBinaryPath(backend);
  if (!binaryPath) {
    const buildCmd = backend === "dotnet" ? "build:cli" : "build:nodeapi";
    throw new Error(
      `Backend "${backend}" was selected but its native binary is missing. Run \`npm run ${buildCmd}\` in @sysutils/ps.`,
    );
  }

  const args: string[] = [];
  if (options?.fields?.length) {
    args.push("--fields", options.fields.join(","));
  }

  const child = spawn(binaryPath, args, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  }) as ChildProcessByStdio<null, ReadableStream, ReadableStream>;

  const parser = createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  });

  const stream = new Readable({ objectMode: true, read() {} }) as ProcessStream;
  stream.process = child;

  parser.on("line", (line) => {
    if (!line) return;
    try {
      const raw = JSON.parse(line) as Record<string, unknown>;
      stream.push(normalizeProcessInfo(raw));
    } catch (err) {
      stream.emit(
        "parseError",
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  });

  parser.on("close", () => {
    if (!stream.destroyed) {
      stream.push(null);
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stream.emit("stderr", chunk);
  });

  child.on("error", (err) => {
    parser.close();
    stream.destroy(err);
  });

  child.on("close", (code) => {
    parser.close();
    if (code !== 0 && !stream.destroyed) {
      stream.destroy(new Error(`ps backend exited with code ${code}`));
    }
  });

  return stream;
}

function parseNdjson(json: string): ProcessInfo[] {
  return json
    .split("\n")
    .filter(Boolean)
    .map((line) =>
      normalizeProcessInfo(JSON.parse(line) as Record<string, unknown>),
    );
}

function loadDotnetNodeapi(binaryPath: string): void {
  if (cachedDotnetAddon) return;
  const dotnet = require("node-api-dotnet/net8.0") as {
    require: (path: string) => {
      PsModule: { listProcesses: (fields: string) => string };
    };
  };
  cachedDotnetAddon = dotnet.require(binaryPath);
}

function listWithDotnetNodeapi(
  options: PsOptions | undefined,
  binaryPath: string,
): ProcessInfo[] {
  loadDotnetNodeapi(binaryPath);
  const fields = options?.fields?.join(",") ?? "";
  const json = cachedDotnetAddon!.PsModule.listProcesses(fields);
  return parseNdjson(json);
}

export async function listProcesses(
  options?: PsOptions,
): Promise<ProcessInfo[]> {
  const requested = options?.backend ?? backendFromEnv() ?? "auto";
  const backend = resolveBackend(options);
  if (backend === "dotnet-nodeapi") {
    const binaryPath = getBinaryPath("dotnet-nodeapi");
    if (!binaryPath) {
      if (requested === "dotnet-nodeapi") {
        if (!nodeApiDotNetAvailable()) {
          throw new Error(
            `Backend "dotnet-nodeapi" was selected but the node-api-dotnet runtime package is not installed.`,
          );
        }
        throw new Error(
          `Backend "dotnet-nodeapi" was selected but its native binary is missing. Run \`npm run build:nodeapi\` in @sysutils/ps.`,
        );
      }
      // Auto selection only reaches here if resolveBackend misidentified availability.
      throw new Error(
        "No @sysutils/ps native backend found. Run `npm run build` in @sysutils/ps (or install a prebuilt binary).",
      );
    }
    try {
      return listWithDotnetNodeapi(options, binaryPath);
    } catch (err) {
      if (requested === "dotnet-nodeapi") throw err;
      // Auto-selection: nodeapi failed, fall back to the dotnet CLI.
      return listProcesses({ ...options, backend: "dotnet" });
    }
  }

  const result: ProcessInfo[] = [];
  for await (const proc of createProcessStream(options)) {
    result.push(proc);
  }
  return result;
}
