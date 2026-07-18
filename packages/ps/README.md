# @sysutils/ps

Cross-platform process listing as a Node.js `Readable` stream.

## Install

```bash
npm install @sysutils/ps
```

`@sysutils/ps` has optional native dependencies. The package tries to use the
fastest backend available for the current platform, falling back to the other.

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
```

### `createProcessStream(options?)`

Returns a `Readable` object-mode stream of `ProcessInfo`.

- `options.backend?: "rust" | "dotnet" | "auto"` — force a native backend or
  let the package choose.
- `options.fields?: string[]` — limit fields, when the backend supports it.

### `listProcesses(options?)`

`Promise<ProcessInfo[]>` — collects the stream for you.

### `getBinaryPath(backend?)`

Resolves the native binary path for a backend.

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

| backend | package | status |
|---|---|---|
| Rust | `@sysutils/ps-rust` | planned |
| .NET | `@sysutils/ps-dotnet` | planned |
