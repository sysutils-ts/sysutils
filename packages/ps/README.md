# @sysutils/ps

Cross-platform process listing as a Node.js `Readable` stream.

`@sysutils/ps` is a thin Node.js wrapper that spawns the fastest available
native backend and streams parsed process objects.

## Install

```bash
npm install @sysutils/ps
```

You also need at least one native backend installed and built:

```bash
npm install @sysutils/ps-rust   # or @sysutils/ps-dotnet
```

## API

```ts
import { createProcessStream, listProcesses, getBinaryPath } from "@sysutils/ps";

// Stream-first API: returns a Node.js Readable of process objects.
const stream = createProcessStream();
for await (const process of stream) {
  console.log(process.pid, process.name, process.ppid);
}

// Convenience collector (uses the stream under the hood).
const all = await listProcesses();

// Force a specific backend or limit fields.
const dotnet = createProcessStream({ backend: "dotnet", fields: ["pid", "name"] });
```

### `createProcessStream(options?)`

Returns a `Readable` object-mode stream of `ProcessInfo`.

- `options.backend?: "rust" | "dotnet" | "auto"` — force a native backend or
  let the package choose. Defaults to `auto` (or `process.env.SYSUTILS_PS_BACKEND`).
- `options.fields?: string[]` — limit fields, when the backend supports it.

The returned stream has a `process` property exposing the spawned `ChildProcess`.
It also emits:

- `stderr` — raw `stderr` chunks from the native backend.
- `parseError` — when a line from the backend is not valid JSON.

### `listProcesses(options?)`

`Promise<ProcessInfo[]>` — collects the stream for you.

### `getBinaryPath(backend?)`

Resolves the absolute path to the native binary for a backend, or `undefined`
if it is not built for the current platform.

## ProcessInfo

```ts
interface ProcessInfo {
  pid: number;
  ppid: number;
  name: string;
  command?: string;
  memory?: number;
  cpu?: number;
}
```

## Backends

| backend | package | language |
|---|---|---|
| Rust | `@sysutils/ps-rust` | Rust (`sysinfo`) |
| .NET | `@sysutils/ps-dotnet` | C# (P/Invoke) |
