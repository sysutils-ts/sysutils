# ADR 0001: Rust vs .NET for `@sysutils/ps` native backends

## Status

Accepted — both implementations are maintained; `@sysutils/ps` auto-selects the
fastest available backend.

## Context

`@sysutils/ps` needs a small, fast, cross-platform native CLI that enumerates
processes and prints one JSON object per line. Node.js then spawns that CLI and
streams the parsed objects to the caller. We want to compare two native stacks
for the CLI: **Rust** and **.NET 8 (Native AOT / single-file)**.

Both approaches ship the same surface area:

- A standalone CLI (`ps` / `ps.exe`) per platform and architecture.
- A tiny Node.js package (`@sysutils/ps-rust` / `@sysutils/ps-dotnet`) that
  exposes `getBinaryPath()` and bundles the prebuilt binaries.
- The same JSON-lines output contract consumed by `@sysutils/ps`.

## Comparison

| Dimension | Rust (`@sysutils/ps-rust`) | .NET (`@sysutils/ps-dotnet`) |
|---|---|---|
| **Language / runtime** | No runtime; compiled to native machine code. | Native AOT or single-file self-contained; still carries a small runtime. |
| **Binary size** | ~1–3 MB after `strip` and `lto`. | ~3–8 MB with trimming and single-file publish. |
| **Process APIs** | `sysinfo` crate abstracts Windows (`CreateToolhelp32Snapshot`), Linux (`/proc`), and macOS (`libproc`). | Manual P/Invoke to `kernel32`, `libSystem.dylib`, and parsing `/proc`. More code per platform. |
| **Cross-compilation** | Needs `cargo-zigbuild` + `zig` or per-OS runners. `rustup target` adds targets easily. | `dotnet publish -r <RID>` from a single Linux runner works for many RIDs; Windows app-host may need a Windows runner. |
| **Build speed** | Slower first build; `cargo` incremental builds are fast. | `dotnet` builds are generally faster and cached via NuGet. |
| **Startup latency** | Very fast; no runtime initialization. | Fast after Native AOT; still slightly behind Rust. |
| **Ecosystem fit** | Excellent for systems programming; crates like `sysinfo`, `serde_json`. | Excellent for teams already using .NET; `System.Text.Json` is built in. |
| **Maintenance risk** | `sysinfo` API churn requires pin and periodic updates. | P/Invoke code is self-owned; no third-party crate risk, but more code to maintain. |
| **Node interop** | Spawn CLI from Node; identical to .NET approach. | Spawn CLI from Node; identical to Rust approach. |
| **Testing** | `cargo test` for unit tests; integration via `node --test`. | `dotnet test` for unit tests; integration via `node --test`. |

## Decision

Use **Rust as the default backend** because the `sysinfo` crate already provides
the fastest, well-tested cross-platform abstraction and produces the smallest
binaries.

Keep **.NET as a first-class alternative** because it is easier to extend with
Windows-specific P/Invoke and fits .NET-heavy environments. `@sysutils/ps`
auto-selects the first built backend (`rust`, then `dotnet`), and users can
force one with `SYSUTILS_PS_BACKEND` or the `backend` option.

## Consequences

- CI must build and publish two native toolchains.
- `packages/ps` must remain backend-agnostic and only depend on the JSON-lines
  contract.
- Each backend package owns its own `binaries.json` mapping.
- Both packages expose `getBinaryPath()` for direct CLI use.
