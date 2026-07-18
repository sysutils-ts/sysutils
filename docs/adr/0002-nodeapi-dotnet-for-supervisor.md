# ADR 0002: In-process Node-API .NET backend for supervisor process monitoring

## Status

Accepted

## Context

`@sysutils/ps` currently spawns a native CLI (`ps.exe` / `ps`) and parses JSON-lines
output. This works, but the supervisor will poll the process list repeatedly. Each
`listProcesses()` call pays the full cost of `child_process.spawn()`, process
tear-down, and JSON parsing, even when the underlying enumeration is fast.

`node-api-dotnet` (Microsoft Node API for .NET) lets a .NET assembly be compiled
into a Node.js native addon (`.node`) using .NET Native AOT. The addon is loaded
once and called in-process, eliminating spawn overhead while keeping the .NET
runtime out of the deployment (AOT).

## Decision

Add a **new package** `@sysutils/ps-nodeapi` (or a new build output under
`@sysutils/ps-dotnet`) that produces a `ps.node` native addon per platform. The
supervisor can then load the addon once and call a `listProcesses(fields)` function
directly. `@sysutils/ps` will keep the CLI backend as a fallback for environments
where the native addon cannot load.

### Why a separate backend package

- `node-api-dotnet` AOT requires a different build profile (`PublishNodeModule`,
  `[JSExport]`, source-generated marshalling) than the standalone CLI.
- Keeping the CLI preserves the ability to call `ps` from shells and from the
  existing `@sysutils/ps` spawn path.
- The new package reuses the low-level process readers already built for
  `@sysutils/ps-dotnet`.

### Data contract

The addon exports a strongly-typed API. Initially it will return a JSON string so
that the Node side can reuse the existing parser, but later iterations may expose
an array of plain objects to remove JSON parsing overhead as well.

```csharp
public static class PsModule
{
    [JSExport]
    public static string ListProcesses(string fields) { ... }
}
```

### Build & packaging

- Target `net8.0` (keeps `IlcDisableReflection` support for smaller AOT).
- Reference `Microsoft.JavaScript.NodeApi` and
  `Microsoft.JavaScript.NodeApi.Generator`.
- `PublishAot` + `PublishNodeModule` produce a `.node` file per RID.
- `@sysutils/ps` package `binaries.json` will be extended with `*-arm64.node` and
  `*-x64.node` entries.

## Consequences

- **Pros**
  - Removes ~10–20 ms spawn overhead on each supervisor poll.
  - No JSON-lines stdout parsing; direct function call.
  - Still no .NET runtime dependency when AOT-compiled.
  - Reuses the same platform readers written for `ps-dotnet`.

- **Cons**
  - `.node` AOT binaries are expected to be larger than the CLI AOT binaries
    ( docs cite 3–10 MB minimum for AOT modules vs our ~822 KB / ~1.16 MB CLI).
  - `node-api-dotnet` is pre-1.0; API churn possible.
  - Needs per-platform build matrix (Windows + MSVC, Linux, macOS).
  - Requires Node.js at runtime; the CLI backend can still run from any shell.

## Measured results

Measured on a Surface Pro X (Windows 11 ARM64 + WSL2 Ubuntu ARM64):

| Backend | Mean call time | Binary size |
|---|---|---|
| `@sysutils/ps-dotnet` CLI spawn + JSON parse | ~28 ms | ~822 KB (win-arm64) |
| `@sysutils/ps-dotnet-nodeapi` in-proc + JSON parse | ~6 ms | ~1.22 MB (win-arm64) |
| `@sysutils/ps-dotnet-nodeapi` in-proc + JSON parse (linux-arm64) | ~6 ms (estimated) | ~1.7 MB (linux-arm64) |

The in-process Node-API backend is roughly **4–5× faster** per `listProcesses()` call
because it eliminates `child_process.spawn()` and process teardown.

## Alternatives considered

1. **Keep CLI spawn only.** Simpler, but spawn overhead accumulates in the
   supervisor polling loop.
2. **Long-lived worker process with streaming JSON.** Avoids repeated spawn, but
   adds process lifecycle complexity and still pays JSON parse.
3. **Rust Node addon (napi-rs).** Viable, but duplicates the platform readers
   already written in C#.

## Related

- ADR 0001: Rust vs .NET for `@sysutils/ps` native backends
- `@sysutils/ps-dotnet` process readers (`WindowsReader`, `LinuxReader`, `MacReader`)
- https://microsoft.github.io/node-api-dotnet/scenarios/js-aot-module.html
