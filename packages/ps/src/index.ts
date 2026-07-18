import { spawn, type ChildProcessByStdio } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import type { Readable as ReadableStream } from "node:stream";

export interface ProcessInfo {
  pid: number;
  ppid: number;
  name: string;
  command?: string;
  memory?: number;
  cpu?: number;
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

function tryResolve(path: string): URL | undefined {
  try {
    return new URL(import.meta.resolve(path));
  } catch {
    return undefined;
  }
}

function binaryPathForPackageRoot(packageRoot: URL): string {
  const platform = process.platform;
  const arch = process.arch;
  const binaryName = platform === "win32" ? "ps.exe" : "ps";
  return new URL(`./bin/${platform}/${arch}/${binaryName}`, packageRoot).pathname;
}

function backendFromEnv(): SupportedBackend | undefined {
  const env = process.env.SYSUTILS_PS_BACKEND;
  if (env === "rust" || env === "dotnet") return env;
  return undefined;
}

export function getBinaryPath(
  backend: SupportedBackend = "rust",
): string | undefined {
  const packageName = BACKEND_PACKAGES[backend];
  const packageRoot = tryResolve(`${packageName}/package.json`);
  if (!packageRoot) return undefined;
  const binaryPath = binaryPathForPackageRoot(packageRoot);
  return existsSync(binaryPath) ? binaryPath : undefined;
}

function resolveBackend(options?: PsOptions): SupportedBackend {
  const requested = options?.backend ?? backendFromEnv() ?? "auto";
  if (requested !== "auto") return requested;
  for (const backend of ["rust", "dotnet"] as SupportedBackend[]) {
    if (getBinaryPath(backend)) return backend;
  }
  throw new Error(
    "No @sysutils/ps backend found. Install @sysutils/ps-rust or @sysutils/ps-dotnet.",
  );
}

export function createProcessStream(options?: PsOptions): ReadableStream {
  const backend = resolveBackend(options);
  const binaryPath = getBinaryPath(backend);
  if (!binaryPath) {
    throw new Error(
      `Backend ${backend} was selected but its binary is missing.`,
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

  async function* generateProcesses() {
    for await (const line of createInterface(child.stdout)) {
      yield JSON.parse(line) as ProcessInfo;
    }
  }

  const stream = Readable.from(generateProcesses(), { objectMode: true });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stream.emit("warning", new Error(`backend stderr: ${chunk.trim()}`));
  });

  stream.once("close", () => {
    if (!child.killed) child.kill();
  });

  return stream;
}

export async function listProcesses(options?: PsOptions): Promise<ProcessInfo[]> {
  const result: ProcessInfo[] = [];
  for await (const proc of createProcessStream(options)) {
    result.push(proc);
  }
  return result;
}
