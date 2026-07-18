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

const BACKEND_PACKAGES: Record<SupportedBackend, string> = {
  dotnet: "@sysutils/ps-dotnet",
  "dotnet-nodeapi": "@sysutils/ps-dotnet-nodeapi",
};

export interface ProcessStream extends ReadableStream {
  process: ChildProcess;
}

function backendFromEnv(): SupportedBackend | undefined {
  const env = process.env.SYSUTILS_PS_BACKEND;
  if (env === "dotnet" || env === "dotnet-nodeapi") return env;
  return undefined;
}

function readBinariesMap(
  packageName: string,
): Record<string, string> | undefined {
  try {
    const entryUrl = new URL(import.meta.resolve(packageName));
    const packageRoot = new URL(".", entryUrl);
    const binariesUrl = new URL("./binaries.json", packageRoot);
    return JSON.parse(
      readFileSync(fileURLToPath(binariesUrl), "utf8"),
    ) as Record<string, string>;
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
  const packageName = BACKEND_PACKAGES[backend];
  const binaries = readBinariesMap(packageName);
  if (!binaries) return undefined;

  const key = `${process.platform}-${process.arch}`;
  const rel = binaries[key];
  if (!rel) return undefined;

  try {
    const entryUrl = new URL(import.meta.resolve(packageName));
    const packageRoot = new URL(".", entryUrl);
    const binaryUrl = new URL(rel, packageRoot);
    const binaryPath = fileURLToPath(binaryUrl);
    if (!existsSync(binaryPath)) return undefined;
    if (backend === "dotnet-nodeapi" && !nodeApiDotNetAvailable())
      return undefined;
    return binaryPath;
  } catch {
    return undefined;
  }
}

function resolveBackend(options?: PsOptions): SupportedBackend {
  const requested = options?.backend ?? backendFromEnv() ?? "auto";
  if (requested !== "auto") return requested;
  const order: SupportedBackend[] = ["dotnet", "dotnet-nodeapi"];
  for (const backend of order) {
    if (getBinaryPath(backend)) return backend;
  }
  throw new Error(
    "No @sysutils/ps backend found. Install @sysutils/ps-dotnet or @sysutils/ps-dotnet-nodeapi and build the native binary.",
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
  const backend = resolveBackend(options);
  if (backend === "dotnet-nodeapi") {
    throw new Error(
      'The "dotnet-nodeapi" backend does not support streaming. Use listProcesses() instead.',
    );
  }
  const binaryPath = getBinaryPath(backend);
  if (!binaryPath) {
    throw new Error(
      `Backend "${backend}" was selected but its native binary is missing. Run the build for ${BACKEND_PACKAGES[backend]}.`,
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

export async function listProcesses(
  options?: PsOptions,
): Promise<ProcessInfo[]> {
  const backend = resolveBackend(options);
  if (backend === "dotnet-nodeapi") {
    const binaryPath = getBinaryPath("dotnet-nodeapi");
    if (binaryPath) {
      try {
        if (!cachedDotnetAddon) {
          const dotnet = require("node-api-dotnet/net8.0") as {
            require: (path: string) => {
              PsModule: { listProcesses: (fields: string) => string };
            };
          };
          cachedDotnetAddon = dotnet.require(binaryPath);
        }
        const fields = options?.fields?.join(",") ?? "";
        const json = cachedDotnetAddon.PsModule.listProcesses(fields);
        return json
          .split("\n")
          .filter((line) => line)
          .map((line) =>
            normalizeProcessInfo(JSON.parse(line) as Record<string, unknown>),
          );
      } catch (err) {
        if (options?.backend === "dotnet-nodeapi") throw err;
        // node-api-dotnet may be installed without the .NET runtime; fall back to the CLI.
      }
    }
    return listProcesses({ ...options, backend: "dotnet" });
  }

  const result: ProcessInfo[] = [];
  for await (const proc of createProcessStream(options)) {
    result.push(proc);
  }
  return result;
}
