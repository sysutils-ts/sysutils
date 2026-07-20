import { spawn, type ChildProcessByStdio } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createRequire } from "node:module";
import path from "node:path";
import { Readable } from "node:stream";
import type { Readable as ReadableStream } from "node:stream";
import { fileURLToPath } from "node:url";
import { createProcStream, procBackendAvailable } from "./proc.js";
import {
  normalizeProcessInfo,
  toBackendFields,
  type ProcessInfo,
  type ProcessStream,
  type PsOptions,
} from "./types.js";

const require = createRequire(import.meta.url);

export { toProcessRow } from "./types.js";
export type {
  ProcessInfo,
  ProcessRow,
  PsOptions,
  ProcessStream,
} from "./types.js";

let cachedDotnetAddon:
  | {
      path: string;
      addon: { PsModule: { listProcesses: (_fields: string) => string } };
    }
  | undefined;

type SupportedBackend = "dotnet" | "dotnet-nodeapi" | "proc";

function backendFromEnv(): SupportedBackend | undefined {
  const env = process.env.SYSUTILS_PS_BACKEND;
  if (env === "dotnet" || env === "dotnet-nodeapi" || env === "proc")
    return env;
  return undefined;
}

type BinariesMap = Record<
  Exclude<SupportedBackend, "proc">,
  Record<string, string>
>;

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

function platformPackageName(): string | undefined {
  const { platform, arch } = process;
  if (
    (platform !== "win32" && platform !== "darwin" && platform !== "linux") ||
    (arch !== "x64" && arch !== "arm64")
  ) {
    return undefined;
  }
  return `@sysutils/ps-${platform}-${arch}`;
}

function cliFileName(): string {
  return process.platform === "win32" ? "ps.exe" : "ps";
}

function nodeapiFileName(): string {
  return "bin/nodeapi/ps-nodeapi.dll";
}

function resolveOptionalDepFile(rel: string): string | undefined {
  const pkgName = platformPackageName();
  if (!pkgName) return undefined;
  try {
    const pkgJsonPath = require.resolve(`${pkgName}/package.json`);
    const pkgRoot = path.dirname(pkgJsonPath);
    const candidate = path.join(pkgRoot, rel);
    if (existsSync(candidate)) return candidate;
  } catch {
    // optional dependency not installed for this platform
  }
  return undefined;
}

function resolveLocalBinary(
  backend: Exclude<SupportedBackend, "proc">,
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
    return binaryPath;
  } catch {
    return undefined;
  }
}

export function getBinaryPath(
  backend: Exclude<SupportedBackend, "proc"> = "dotnet",
): string | undefined {
  // Test seam: allow tests to point nodeapi at a temporary copy so they can
  // simulate missing/corrupt assemblies without mutating the real build artifact.
  if (
    backend === "dotnet-nodeapi" &&
    process.env.SYSUTILS_PS_TEST_NODEAPI_PATH
  ) {
    const override = process.env.SYSUTILS_PS_TEST_NODEAPI_PATH;
    if (existsSync(override) && nodeApiDotNetAvailable()) return override;
    return undefined;
  }

  const rel = backend === "dotnet" ? `bin/${cliFileName()}` : nodeapiFileName();
  const fromOptional = resolveOptionalDepFile(rel);
  if (fromOptional) {
    if (backend === "dotnet-nodeapi" && !nodeApiDotNetAvailable())
      return undefined;
    return fromOptional;
  }

  return resolveLocalBinary(backend);
}

function resolveAutoBackend(): SupportedBackend {
  if (process.platform === "linux" && procBackendAvailable()) return "proc";
  if (getBinaryPath("dotnet")) return "dotnet";
  if (getBinaryPath("dotnet-nodeapi")) return "dotnet-nodeapi";
  if (procBackendAvailable()) return "proc";
  throw new Error(
    "No @sysutils/ps native backend found. Run `npm run build` in @sysutils/ps (or install a prebuilt binary).",
  );
}

function resolveExplicitBackend(requested: SupportedBackend): SupportedBackend {
  if (requested === "proc") {
    if (!procBackendAvailable()) {
      throw new Error("The /proc backend is only available on Linux.");
    }
    return "proc";
  }
  return requested;
}

function resolveBackend(options?: PsOptions): SupportedBackend {
  const requested = options?.backend ?? backendFromEnv() ?? "auto";
  if (requested === "auto") return resolveAutoBackend();
  if (
    requested !== "dotnet" &&
    requested !== "dotnet-nodeapi" &&
    requested !== "proc"
  ) {
    throw new Error(
      `Invalid \`@sysutils/ps\` backend: "${requested}". Expected "auto", "dotnet", "dotnet-nodeapi", or "proc".`,
    );
  }
  return resolveExplicitBackend(requested);
}

function pushJsonLine(
  stream: ProcessStream,
  line: string,
  requestedFields?: string[],
): void {
  if (!line) return;
  try {
    const raw = JSON.parse(line) as Record<string, unknown>;
    stream.push(normalizeProcessInfo(raw, requestedFields));
  } catch (err) {
    stream.emit(
      "parseError",
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}

function createNodeapiStream(args: {
  binaryPath: string;
  fields?: string[];
  requestedFields?: string[];
}): ProcessStream {
  const stream = new Readable({
    objectMode: true,
    read() {},
  }) as ProcessStream;

  // Defer the synchronous in-process work so callers that consume via the
  // stream/async iterator do not block the event loop during setup.
  setImmediate(() => {
    try {
      const json = getNodeapiJson(args.fields, args.binaryPath);
      for (const line of json.split("\n")) {
        pushJsonLine(stream, line, args.requestedFields);
      }
      stream.push(null);
    } catch (err) {
      stream.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  });

  return stream;
}

export function createProcessStream(options?: PsOptions): ProcessStream {
  const backend = resolveBackend(options);
  const requestedFields = options?.fields;
  const backendFields = toBackendFields(requestedFields);

  if (backend === "proc") {
    return createProcStream({
      fields: backendFields,
      requestedFields,
    });
  }

  if (backend === "dotnet-nodeapi") {
    const binaryPath = getBinaryPath("dotnet-nodeapi");
    if (!binaryPath) {
      if (!nodeApiDotNetAvailable()) {
        throw new Error(
          `Backend "dotnet-nodeapi" was selected but the node-api-dotnet runtime package is not installed.`,
        );
      }
      throw new Error(
        `Backend "dotnet-nodeapi" was selected but its native binary is missing. Run \`npm run build:nodeapi\` in @sysutils/ps.`,
      );
    }
    return createNodeapiStream({
      binaryPath,
      fields: backendFields,
      requestedFields,
    });
  }

  const binaryPath = getBinaryPath(backend);
  if (!binaryPath) {
    throw new Error(
      `Backend "${backend}" was selected but its native binary is missing. Run \`npm run build:cli\` in @sysutils/ps.`,
    );
  }

  const args: string[] = [];
  if (backendFields?.length) {
    args.push("--fields", backendFields.join(","));
  }

  const child = spawn(binaryPath, args, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  }) as ChildProcessByStdio<null, ReadableStream, ReadableStream>;

  const parser = createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  });

  const stream = new Readable({
    objectMode: true,
    read() {},
    destroy(err, cb) {
      child.kill();
      cb(err);
    },
  }) as ProcessStream;
  stream.process = child;

  parser.on("line", (line) => {
    pushJsonLine(stream, line, requestedFields);
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

function loadDotnetNodeapi(binaryPath: string): void {
  if (cachedDotnetAddon && cachedDotnetAddon.path === binaryPath) return;
  const dotnet = require("node-api-dotnet/net8.0") as {
    require: (path: string) => {
      PsModule: { listProcesses: (fields: string) => string };
    };
  };
  cachedDotnetAddon = { path: binaryPath, addon: dotnet.require(binaryPath) };
}

function getNodeapiJson(
  fields: string[] | undefined,
  binaryPath: string,
): string {
  loadDotnetNodeapi(binaryPath);
  return cachedDotnetAddon!.addon.PsModule.listProcesses(
    fields?.join(",") ?? "",
  );
}

async function collectStream(stream: ProcessStream): Promise<ProcessInfo[]> {
  const result: ProcessInfo[] = [];
  for await (const proc of stream) {
    result.push(proc as ProcessInfo);
  }
  return result;
}

export async function listProcesses(
  options?: PsOptions,
): Promise<ProcessInfo[]> {
  const backend = resolveBackend(options);
  if (backend !== "dotnet-nodeapi" || options?.backend === "dotnet-nodeapi") {
    return collectStream(createProcessStream(options));
  }

  // Env-selected nodeapi may be missing or corrupt; fall back to the dotnet CLI
  // (or the /proc backend on Linux) before giving up.
  try {
    return await collectStream(createProcessStream(options));
  } catch {
    return listProcesses({ ...options, backend: "auto" });
  }
}
