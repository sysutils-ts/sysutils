import { spawn, type ChildProcess, type ChildProcessByStdio } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import type { Readable as ReadableStream } from "node:stream";
import { fileURLToPath } from "node:url";

export interface ProcessInfo {
  pid: number;
  ppid: number;
  name: string;
  command?: string;
  memory?: number;
  cpu?: number;
  [key: string]: unknown;
}

export interface PsOptions {
  backend?: "rust" | "dotnet" | "auto";
  fields?: string[];
}

type SupportedBackend = "rust" | "dotnet";

const BACKEND_PACKAGES: Record<SupportedBackend, string> = {
  rust: "@sysutils/ps-rust",
  dotnet: "@sysutils/ps-dotnet",
};

export interface ProcessStream extends ReadableStream {
  process: ChildProcess;
}

function backendFromEnv(): SupportedBackend | undefined {
  const env = process.env.SYSUTILS_PS_BACKEND;
  if (env === "rust" || env === "dotnet") return env;
  return undefined;
}

function readBinariesMap(
  packageName: string,
): Record<string, string> | undefined {
  try {
    const packageJsonUrl = new URL(
      import.meta.resolve(`${packageName}/package.json`),
    );
    const binariesUrl = new URL("./binaries.json", packageJsonUrl);
    return JSON.parse(
      readFileSync(fileURLToPath(binariesUrl), "utf8"),
    ) as Record<string, string>;
  } catch {
    return undefined;
  }
}

export function getBinaryPath(
  backend: SupportedBackend = "rust",
): string | undefined {
  const packageName = BACKEND_PACKAGES[backend];
  const binaries = readBinariesMap(packageName);
  if (!binaries) return undefined;

  const key = `${process.platform}-${process.arch}`;
  const rel = binaries[key];
  if (!rel) return undefined;

  try {
    const packageJsonUrl = new URL(
      import.meta.resolve(`${packageName}/package.json`),
    );
    const binaryUrl = new URL(rel, packageJsonUrl);
    const binaryPath = fileURLToPath(binaryUrl);
    return existsSync(binaryPath) ? binaryPath : undefined;
  } catch {
    return undefined;
  }
}

function resolveBackend(options?: PsOptions): SupportedBackend {
  const requested = options?.backend ?? backendFromEnv() ?? "auto";
  if (requested !== "auto") return requested;
  for (const backend of ["rust", "dotnet"] as SupportedBackend[]) {
    if (getBinaryPath(backend)) return backend;
  }
  throw new Error(
    "No @sysutils/ps backend found. Install @sysutils/ps-rust or @sysutils/ps-dotnet and build the native binary.",
  );
}

export function createProcessStream(options?: PsOptions): ProcessStream {
  const backend = resolveBackend(options);
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
      const obj = JSON.parse(line) as ProcessInfo;
      stream.push(obj);
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
  const result: ProcessInfo[] = [];
  for await (const proc of createProcessStream(options)) {
    result.push(proc);
  }
  return result;
}
