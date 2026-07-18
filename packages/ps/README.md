# @sysutils/ps

Fast, cross-platform process listing for Node.js — with a stream-first API,
pluggable native backends, and no dependency on external tools like `ps` or
`tasklist`.

```ts
import { listProcesses, createProcessStream } from "@sysutils/ps";

// Convenience collector
const all = await listProcesses();

// Or stream process objects as they are parsed
const stream = createProcessStream();
for await (const process of stream) {
  console.log(process.pid, process.name, process.ppid);
}
```

## Why another process library?

The most popular Node.js package for this, [`ps-list`](https://www.npmjs.com/package/ps-list),
works well on common platforms but has a few sharp edges that become painful in
long-running tools, supervisors, or resource-constrained environments:

- **It spawns `ps` on every call on Linux/macOS.** That means parsing
  whitespace-delimited output, trusting the installed `ps` version, and paying
  fork/exec overhead each poll.
- **Windows support is incomplete.** `ps-list` ships a small `fastlist` binary,
  but it only returns `pid`, `ppid`, and `name` — no `cmd`, `path`, `uid`,
  `startTime`, `cpu`, or `memory`.
- **Windows ARM64 is not supported.** The `fastlist` binary is x86/x64 only.
- **There is no streaming API.** `ps-list` always materializes the whole array
  at once, even when you only need a subset.
- **You cannot ask for specific fields.** Every call pays the full cost of
  collecting all data.

`@sysutils/ps` addresses each of these:

- Native AOT binaries for Windows, Linux, and macOS (including **Windows ARM64**)
  are bundled with the package — no `ps`, `tasklist`, or `.NET` runtime is
  required at runtime.
- Returns `Readable` object-mode streams so you can process processes lazily.
- Supports a `fields` option so the backend only collects what you need.
- Provides `ProcessInfo` fields that match `ps-list` on Linux for easy migration.
- Offers an optional in-process backend that removes spawn overhead entirely
  when `node-api-dotnet` is stable in your environment.

## Install

```bash
npm install @sysutils/ps
```

The package ships prebuilt native binaries for Windows, Linux, and macOS
(`x64` and `arm64`).

For the experimental in-process backend you also need `node-api-dotnet`:

```bash
npm install node-api-dotnet
```

> **Note:** `node-api-dotnet@0.9.21` has an open shutdown bug on Node.js
> ≥ 24.14.0 that can crash or hang the process on exit. The in-process backend
> is therefore opt-in; see [Backends](#backends) below.

## Quick start

```ts
import { listProcesses, createProcessStream } from "@sysutils/ps";

// All processes, fastest available backend
const all = await listProcesses();

// Stream and stop early
const stream = createProcessStream({ fields: ["pid", "name"] });
for await (const proc of stream) {
  if (proc.name === "node") {
    stream.destroy();
    break;
  }
}

// Force a specific backend
const procs = await listProcesses({
  backend: "dotnet-nodeapi",
  fields: ["pid", "ppid", "name"],
});
```

You can also set a default backend via `process.env.SYSUTILS_PS_BACKEND`:

```bash
SYSUTILS_PS_BACKEND=dotnet node app.js
```

## API

### `createProcessStream(options?)`

Returns a `Readable` object-mode stream of `ProcessInfo`.

- `options.backend?: "dotnet" | "dotnet-nodeapi" | "auto"` — force a backend
  or let the package choose. Defaults to `auto` (or
  `process.env.SYSUTILS_PS_BACKEND`).
- `options.fields?: string[]` — limit fields, when the backend supports it.

The returned stream has a `process` property exposing the spawned
`ChildProcess` and emits:

- `stderr` — raw `stderr` chunks from the native backend.
- `parseError` — when a line from the backend is not valid JSON.

### `listProcesses(options?)`

`Promise<ProcessInfo[]>` — collects the stream for you.

### `getBinaryPath(backend?)`

Resolves the absolute path to the native binary / assembly for a backend, or
`undefined` if it is not built for the current platform.

## ProcessInfo

```ts
interface ProcessInfo {
  pid: number; // process ID
  ppid: number; // parent process ID
  uid?: number; // user ID (Linux)
  name: string; // executable name
  cmd?: string; // full command line (Linux)
  path?: string; // executable path (Linux, macOS)
  startTime?: Date; // process start time (Linux)
  cpu?: number; // CPU usage as a percent of one CPU (Linux)
  memory?: number; // resident memory as a percent of total RAM (Linux)
}
```

`ProcessInfo` is intentionally aligned with `ps-list` so migration is a drop-in
replacement for the Linux/Unix case. On Windows the shape matches `ps-list` on
Windows (`pid`, `ppid`, `name`) plus optional extras where available.

## Backends

| backend         | location in `@sysutils/ps` | type                                         | default |
| --------------- | -------------------------- | -------------------------------------------- | ------- |
| .NET CLI        | `bin/<platform>/<arch>/ps` | Native AOT executable (spawn)                | yes     |
| .NET in-process | `bin/nodeapi/<rid>/`       | Managed assembly loaded by `node-api-dotnet` | no      |

### .NET CLI (default)

A self-contained, AOT-compiled native binary (`ps.exe` / `ps`) is spawned once
per `createProcessStream()` call. It emits newline-delimited JSON on `stdout`,
which `@sysutils/ps` parses and streams. This backend works everywhere the
binaries are built and is the safest default because it runs in an isolated
process.

### .NET in-process (opt-in)

A managed .NET assembly is loaded directly into the Node.js process via
`node-api-dotnet`. This removes spawn overhead and is noticeably faster, but
`node-api-dotnet@0.9.21` has an open Node-API shutdown bug on Node.js ≥ 24.14.0
([microsoft/node-api-dotnet#480](https://github.com/microsoft/node-api-dotnet/pull/480))
that can crash or hang the process on exit. Use it only when your Node version
and platform are unaffected, or when you are willing to accept that risk:

```ts
const procs = await listProcesses({ backend: "dotnet-nodeapi" });
```

## Comparison

| Feature                                                            | `@sysutils/ps` (CLI) | `@sysutils/ps` (nodeapi) | `ps-list`              |
| ------------------------------------------------------------------ | -------------------- | ------------------------ | ---------------------- |
| Cross-platform (Windows/Linux/macOS)                               | yes                  | yes                      | yes                    |
| Windows ARM64                                                      | yes                  | yes                      | no                     |
| No external `ps`/`tasklist` dependency                             | yes                  | yes                      | no (uses `ps` on Unix) |
| Stream-first API                                                   | yes                  | yes                      | no                     |
| Select fields per call                                             | yes                  | yes                      | no                     |
| Full `ps-list` field set on Linux                                  | yes                  | yes                      | yes                    |
| `uid` / `cmd` / `path` / `startTime` / `cpu` / `memory` on Linux   | yes                  | yes                      | yes                    |
| `uid` / `cmd` / `path` / `startTime` / `cpu` / `memory` on Windows | no                   | no                       | no                     |
| In-process / no spawn                                              | no                   | yes                      | no                     |
| Runtime dependency                                                 | none (AOT binary)    | .NET 8 runtime           | `ps` binary on Unix    |

## Benchmarks

Measured on a Surface Pro X (Windows 11 ARM64 + WSL2 Ubuntu ARM64, Node.js
26.x, ~450 processes):

| Backend                                            | Mean `listProcesses()`                         | Notes                                            |
| -------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------ |
| `@sysutils/ps-dotnet` CLI spawn + JSON parse       | ~28 ms (Windows), similar on Linux             | Includes full `ProcessInfo` fields               |
| `@sysutils/ps-dotnet-nodeapi` in-proc + JSON parse | ~6 ms (Windows), ~0.8 ms (Linux)               | Fastest, but opt-in due to upstream shutdown bug |
| `ps-list`                                          | unsupported on Windows ARM64, ~7.8 ms on Linux | Spawns `ps` and parses fixed output              |

The in-process backend is roughly **4–35× faster** than the CLI spawn path and
`ps-list` on Linux, and it supports Windows ARM64 where `ps-list` does not.

## Building from source

The repository uses `npm` workspaces:

```bash
npm install
npm run typecheck
npm run build
npm run test
npm run lint
```

`npm run build` only bundles the TypeScript entrypoint. To also build the
native CLI and in-process backends for the current platform, run:

```bash
npm run build:cli       # native AOT CLI binary
npm run build:nodeapi   # node-api-dotnet assembly
npm run build           # TypeScript bundle
```

To cross-compile all supported RIDs (requires .NET 8 SDK):

```bash
npm run build:all
```

## See also

- `native/cli/` — .NET AOT CLI backend source.
- `native/nodeapi/` — in-process `node-api-dotnet` backend source.
- [ADR 0002: In-process `node-api-dotnet` backend](../../docs/adr/0002-nodeapi-dotnet-for-supervisor.md).
