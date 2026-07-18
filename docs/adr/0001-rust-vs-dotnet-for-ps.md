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
| **Binary size** | ~400–520 KB after `strip` and `lto`. | ~2.1–2.6 MB with Native AOT; single-file can be larger. |
| **Process APIs** | `sysinfo` crate abstracts Windows (`CreateToolhelp32Snapshot`), Linux (`/proc`), and macOS (`libproc`). | Manual P/Invoke to `kernel32`, `libSystem.dylib`, and parsing `/proc`. More code per platform. |
| **Cross-compilation** | Needs `cargo-zigbuild` + `zig` or per-OS runners. `rustup target` adds targets easily. | `dotnet publish -r <RID>` from a single Linux runner works for many RIDs; Windows Native AOT requires a Windows build host with MSVC. |
| **Build speed** | Slower first build; `cargo` incremental builds are fast. | `dotnet` builds are generally faster and cached via NuGet. |
| **Startup latency** | Very fast; no runtime initialization. | Very fast after Native AOT; beats the Rust `sysinfo` implementation on Linux and ARM64 Windows. |
| **Ecosystem fit** | Excellent for systems programming; crates like `sysinfo`, `serde_json`. | Excellent for teams already using .NET; `System.Text.Json` is built in. |
| **Maintenance risk** | `sysinfo` API churn requires pin and periodic updates. | P/Invoke code is self-owned; no third-party crate risk, but more code to maintain. |
| **Node interop** | Spawn CLI from Node; identical to .NET approach. | Spawn CLI from Node; identical to Rust approach. |
| **Testing** | `cargo test` for unit tests; integration via `node --test`. | `dotnet test` for unit tests; integration via `node --test`. |

## Benchmarks

Measured on a Surface Pro X (Windows 11 ARM64 + WSL2 Ubuntu ARM64):

| Command | WSL/Linux | Windows |
|---|---|---|
| native `ps -e -o pid,ppid,comm` | ~3.6 ms | n/a |
| `fastlist` (pid, ppid, name) | n/a | ~37 ms (x64 emulation) |
| `@sysutils/ps-rust` (pid, ppid, name) | ~69 ms | ~52 ms (x64 emulation) |
| `@sysutils/ps-rust` (all fields) | ~64 ms | ~79 ms (x64 emulation) |
| `@sysutils/ps-dotnet` AOT (pid, ppid, name) | ~24 ms | **~35 ms (arm64)**, ~53 ms (x64 emulation) |
| `@sysutils/ps-dotnet` AOT (all fields) | ~24 ms | **~35 ms (arm64)** |
| `@sysutils/ps-dotnet` single-file (pid, ppid, name) | ~480 ms | ~180 ms (x64 emulation) |
| `tasklist` | n/a | ~360 ms |
| `powershell Get-CimInstance` | n/a | ~950 ms |

> **Note:** All Windows binaries except the native ARM64 .NET AOT build were
> measured under x64 emulation on an ARM64 Windows host. The x64 `fastlist` still
> wins in raw speed, but the native ARM64 .NET AOT build is the fastest
> cross-platform, feature-complete option on this machine.

### Binary sizes

Measured on the same builds:

| Binary | Size |
|---|---|
| `fastlist-0.3.0-x64.exe` | ~266 KB |
| `@sysutils/ps-rust` win-x64 | ~397 KB |
| `@sysutils/ps-rust` linux-arm64 | ~517 KB |
| `@sysutils/ps-dotnet` AOT win-arm64 | ~2.1 MB |
| `@sysutils/ps-dotnet` AOT win-x64 | ~2.2 MB |
| `@sysutils/ps-dotnet` AOT linux-arm64 | ~2.6 MB |

Key findings:

- **Linux:** .NET Native AOT is the fastest option (~24 ms), beating the Rust
  `sysinfo` implementation by roughly 2–3x. The AOT binary outputs JSON with
  `command`, `memory`, and `cpu` at no extra cost because the Linux `/proc`
  reader already gathers those fields.
- **Windows:** .NET Native AOT built natively on ARM64 Windows is the fastest
  feature-complete option (~35 ms), ahead of the Rust x64-emulated build (~52 ms)
  and within reach of x64 `fastlist` (~37 ms). .NET single-file on Windows pays
  a JIT/startup penalty and is ~3x slower.
- **Node wrapper overhead** is small: `listProcesses` from `@sysutils/ps` adds
  ~10–20 ms to the native binary time.
- `ps-list`/`fastlist` does not support Windows ARM64, which is one reason we
  built our own tool.

## Decision

Use **.NET Native AOT as the default backend on Linux** and **Rust as the
cross-platform default on Windows/macOS**. `@sysutils/ps` auto-selects in that
order per platform (`dotnet` first on Linux, `rust` first elsewhere), and users
can force one with `SYSUTILS_PS_BACKEND` or the `backend` option.

When a Windows build host with MSVC is available, .NET Native AOT for Windows
(`win-x64`, `win-arm64`) is also a top-tier option and can be selected
explicitly with `backend: "dotnet"`.

Keep **both** as first-class backends so CI and users can choose based on the
target platform and toolchain constraints.

## Consequences

- CI must build and publish two native toolchains.
- `packages/ps` must remain backend-agnostic and only depend on the JSON-lines
  contract.
- Each backend package owns its own `binaries.json` mapping.
- Both packages expose `getBinaryPath()` for direct CLI use.
- Windows .NET Native AOT requires a Windows runner with the .NET SDK and MSVC
  build tools; cross-published Windows binaries fall back to single-file.
