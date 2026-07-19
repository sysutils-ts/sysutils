# ADR 0001: Native backend for `@sysutils/ps`

## Status

Accepted — Rust backend removed; .NET is the single maintained native stack.

## Context

`@sysutils/ps` needs a small, fast, cross-platform native component that
enumerates processes and prints one JSON object per line. Node.js consumes that
output either by spawning a CLI or by loading a .NET assembly in-process.

We evaluated Rust (`sysinfo` crate) and .NET 8 (P/Invoke + Native AOT / single
file). The Rust implementation was a useful spike, but maintaining two separate
platform readers duplicated effort with the .NET Node-API in-process backend.

## Decision

Use **.NET** as the only maintained native stack for `@sysutils/ps`. Both the
CLI and the in-process backend live inside the `@sysutils/ps` package:

- `packages/ps/native/cli/` — standalone Native AOT / single-file CLI binary.
- `packages/ps/native/nodeapi/` — managed assembly loaded by `node-api-dotnet`
  for in-process calls from Node.js.
- `packages/ps/native/Program.cs` — shared `WindowsReader`, `LinuxReader`, and
  `MacReader` implementations.

## Comparison

| Dimension             | `@sysutils/ps` CLI (AOT / single-file)        | `@sysutils/ps` in-process (`node-api-dotnet`)          |
| --------------------- | --------------------------------------------- | ------------------------------------------------------- |
| Language / runtime    | Native AOT or single-file self-contained      | Managed DLL loaded by `node-api-dotnet`                 |
| Binary size           | ~822 KB–1.3 MB (AOT)                          | ~500 KB (assembly + `Microsoft.JavaScript.NodeApi.dll`) |
| Startup latency       | ~28 ms native binary (win-arm64 AOT)          | ~6 ms (Windows), ~0.8 ms (Linux)                        |
| .NET runtime required | No (AOT / self-contained)                     | Yes                                                     |
| Cross-compilation     | `dotnet publish -r <RID>`; Windows AOT needs MSVC host | `dotnet publish -r <RID>` from any .NET SDK host |
| Node interop          | `child_process.spawn` of CLI                  | `node-api-dotnet` in-process call                       |
| Testing               | `dotnet test` + `node --test`                 | `dotnet test` + `node --test`                           |

## Measured results

Measured on a Surface Pro X (Windows 11 ARM64 + WSL2 Ubuntu ARM64). Timings for
the `@sysutils/ps` CLI and in-process backends below were measured with a
**limited `pid,ppid,name` field set**; the CLI also incurs Node.js spawn and
JSON-parse overhead on top of the ~28 ms native binary time.

| Command                                                 | WSL/Linux | Windows                      |
| ------------------------------------------------------- | --------- | ---------------------------- |
| native `ps -e -o pid,ppid,comm`                         | ~3.6 ms   | n/a                          |
| `fastlist` (pid, ppid, name)                            | n/a       | ~37 ms (x64 emulation)       |
| `@sysutils/ps` CLI `pid,ppid,name` (native binary only) | ~20 ms    | ~28 ms (arm64)               |
| `@sysutils/ps` in-process (`node-api-dotnet`)           | ~0.8 ms   | ~6 ms                        |
| `ps-list`                                               | ~7.8 ms   | unsupported on Windows ARM64 |
| `tasklist`                                              | n/a       | ~360 ms                      |

The in-process `node-api-dotnet` backend is the fastest option and supports
Windows ARM64, which `ps-list`/`fastlist` do not.

## ProcessInfo fields

Both .NET backends emit the same JSON-lines contract, aligned with
[`ps-list`](https://www.npmjs.com/package/ps-list):

```ts
interface ProcessInfo {
  pid: number;
  ppid: number;
  uid?: number;
  name: string;
  cmd?: string;
  path?: string;
  startTime?: Date;
  cpu?: number; // percent of one CPU
  memory?: number; // percent of total physical memory
}
```

`LinuxReader` populates all fields from `/proc`. `WindowsReader` and `MacReader`
currently emit `pid`, `ppid`, and `name`; `MacReader` also emits `path` when
available. Additional fields are `null` when not available.

## Consequences

- Only one set of platform readers needs maintenance.
- CI builds one `@sysutils/ps` package with both CLI and in-process binaries.
- `@sysutils/ps` defaults to the CLI backend and uses `dotnet-nodeapi` when
  requested, set via `SYSUTILS_PS_BACKEND`, or selected automatically when the CLI
  binary is unavailable, because `node-api-dotnet` can hang or crash on Node shutdown
  in some test environments.
- The Rust package (`packages/ps-rust`) is removed from source control.
