# @sysutils/ps

Cross-platform process listing as a Node.js `Readable` stream.

`@sysutils/ps` is a thin Node.js wrapper that selects the fastest available
backend and streams parsed process objects.

## Install

```bash
npm install @sysutils/ps
```

You also need at least one backend installed and built:

```bash
npm install @sysutils/ps-dotnet
# or, for in-process .NET interop
npm install @sysutils/ps-dotnet-nodeapi
```

## API

```ts
import {
  createProcessStream,
  listProcesses,
  getBinaryPath,
} from "@sysutils/ps";

// Stream-first API: returns a Node.js Readable of process objects.
const stream = createProcessStream();
for await (const process of stream) {
  console.log(process.pid, process.name, process.ppid);
}

// Convenience collector.
const all = await listProcesses();

// Force a specific backend or limit fields.
const dotnet = createProcessStream({
  backend: "dotnet",
  fields: ["pid", "name"],
});
```

### `createProcessStream(options?)`

Returns a `Readable` object-mode stream of `ProcessInfo`.

- `options.backend?: "dotnet" | "dotnet-nodeapi" | "auto"` — force a backend or
  let the package choose. Defaults to `auto` (or `process.env.SYSUTILS_PS_BACKEND`).
- `options.fields?: string[]` — limit fields, when the backend supports it.

The returned stream has a `process` property exposing the spawned `ChildProcess`.
It also emits:

- `stderr` — raw `stderr` chunks from the native backend.
- `parseError` — when a line from the backend is not valid JSON.

### `listProcesses(options?)`

`Promise<ProcessInfo[]>` — collects the stream for you.

### `getBinaryPath(backend?)`

Resolves the absolute path to the native binary / assembly for a backend, or `undefined`
if it is not built for the current platform.

## ProcessInfo

```ts
interface ProcessInfo {
  pid: number;
  ppid: number;
  uid?: number;
  name: string;
  cmd?: string;
  path?: string;
  startTime?: Date;
  cpu?: number;
  memory?: number;
}
```

## Backends

| backend         | package                       | type                                         | default |
| --------------- | ----------------------------- | -------------------------------------------- | ------- |
| .NET CLI        | `@sysutils/ps-dotnet`         | Native AOT executable (spawn)                | yes     |
| .NET in-process | `@sysutils/ps-dotnet-nodeapi` | Managed assembly loaded by `node-api-dotnet` | no      |

The .NET CLI backend is selected by default. The in-process backend is faster
but is currently opt-in because `node-api-dotnet` 0.9.21 has an open Node-API
shutdown bug on Node.js >= 24.14.0 that can crash or hang the process on exit.

```ts
// Opt in to the in-process backend
const procs = await listProcesses({ backend: "dotnet-nodeapi" });
```
