# ADR 0002: In-process `node-api-dotnet` backend for supervisor process monitoring

## Status

Accepted, with runtime caveats

## Context

`@sysutils/ps` currently spawns a native CLI (`ps.exe` / `ps`) and parses
JSON-lines output. This works, but the supervisor polls the process list
repeatedly. Each `listProcesses()` call pays the full cost of
`child_process.spawn()`, process tear-down, and JSON parsing, even when the
underlying enumeration is fast.

[`node-api-dotnet`](https://www.npmjs.com/package/node-api-dotnet) lets a .NET
assembly be loaded into the Node.js process and called directly. The assembly is
built as a managed DLL (no AOT native addon) and is loaded by the
`node-api-dotnet/net8.0` entry point. This keeps the implementation in a single
shared C# file while removing spawn overhead.

## Decision

Add a `nodeapi` native backend under `packages/ps/native/nodeapi` that builds a
managed .NET assembly exposing `PsModule.ListProcesses(fields)` and load it with
`node-api-dotnet`. Both backends ship inside `@sysutils/ps`; the CLI binary is
loaded from `bin/<platform>/<arch>/ps` and the nodeapi assembly from
`bin/nodeapi/<rid>/ps-nodeapi.dll`. `@sysutils/ps` will keep the CLI backend as
the default and use the in-process backend only when explicitly requested
(`backend: "dotnet-nodeapi"`) until `node-api-dotnet` resolves its Node-API
shutdown instability on Node.js >= 24.14.0.

The assembly returns a JSON-lines string so the Node side can reuse the existing
parser and `ProcessInfo` normalization.

### Native backend layout

- Both backends live inside `@sysutils/ps` under `packages/ps/native/`:
  `cli/` for the AOT CLI and `nodeapi/` for the in-process assembly.
- They share `packages/ps/native/Program.cs`, so platform readers are not
  duplicated.
- `packages/ps/binaries.json` maps `process.platform-process.arch` to the
  correct binary path for each backend.
- The CLI backend is the default for environments where `node-api-dotnet` or
  the .NET runtime is unavailable, or where the Node-API shutdown bug is hit.

### Data contract

The assembly exports:

```csharp
public static class PsModule
{
    [JSExport]
    public static string ListProcesses(string fields) { ... }
}
```

The returned string contains one JSON object per line. `ProcessInfo` aligns with
[`ps-list`](https://www.npmjs.com/package/ps-list) where possible:

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

On Linux, all fields are populated from `/proc`. On Windows and macOS, only
`pid`, `ppid`, and `name` are guaranteed (matching `ps-list` on Windows); extra
fields are `null` when not available.

### Build & packaging

- Target `net8.0`.
- Reference `Microsoft.JavaScript.NodeApi` and
  `Microsoft.JavaScript.NodeApi.Generator`.
- `dotnet publish -r <RID>` in `packages/ps/native/nodeapi` outputs
  `packages/ps/bin/nodeapi/<RID>/ps-nodeapi.dll` plus
  `Microsoft.JavaScript.NodeApi.dll`.
- `dotnet publish -r <RID>` in `packages/ps/native/cli` outputs a
  self-contained AOT single-file binary to
  `packages/ps/bin/<platform>/<arch>/ps`.
- The `node-api-dotnet` npm package is declared as an optional dependency of
  `@sysutils/ps`.

## Consequences

### Pros

- Removes `child_process.spawn()` overhead on each supervisor poll.
- No per-platform AOT native addon build; cross-publish works from any .NET SDK.
- Reuses the same platform readers written for `ps-dotnet`.
- Windows ARM64 is supported without x64 emulation.

### Cons

- Requires the .NET 8 runtime to be installed on the target system.
- `node-api-dotnet` is pre-1.0; API churn possible.
- `node-api-dotnet` 0.9.21 has an open Node-API shutdown bug on Node.js >=
  24.14.0 that can crash or hang the process on exit, so the in-process backend
  is opt-in for now.
- The CLI backend must still be built and tested as the default/fallback.

## Measured results

Measured on a Surface Pro X (Windows 11 ARM64 + WSL2 Ubuntu ARM64):

| Backend                                          | Mean `listProcesses()`                        | Output size               |
| ------------------------------------------------ | --------------------------------------------- | ------------------------- |
| `@sysutils/ps` CLI spawn + JSON parse            | ~28 ms                                        | ~822 KB (win-arm64)       |
| `@sysutils/ps` in-proc (`node-api-dotnet`)       | ~6 ms (Windows), ~0.8 ms (Linux)              | ~500 KB (assembly + deps) |
| `ps-list`                                        | ~7.8 ms (Linux), unsupported on Windows ARM64 | n/a                       |

The in-process backend is roughly **4–35× faster** than the CLI spawn path and
`ps-list` on Linux, and it supports Windows ARM64 where `ps-list` does not.

## Alternatives considered

1. **Keep CLI spawn only.** Simpler, but spawn overhead accumulates in the
   supervisor polling loop.
2. **Long-lived worker process with streaming JSON.** Avoids repeated spawn, but
   adds process lifecycle complexity and still pays JSON parse.
3. **.NET Native AOT `.node` addon.** Faster startup, but requires per-platform
   AOT builds and we hit a Node 26 / Node-API exit-code quirk when running inside
   `node --test`.
4. **Rust Node addon (napi-rs).** Viable, but duplicates the platform readers
   already written in C#; removed as a maintained backend.

## Related

- ADR 0001: Rust vs .NET for `@sysutils/ps` native backends
- `packages/ps/native/Program.cs` — process readers (`WindowsReader`, `LinuxReader`, `MacReader`)
- https://www.npmjs.com/package/node-api-dotnet
