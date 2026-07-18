# @sysutils

Cross-platform, stream-first system utilities for Node.js.

`@sysutils` is a monorepo of small, focused packages that expose OS-level
information (processes, network, disks, etc.) through Node.js streams. Each
utility ships its own native backend(s) and exposes a single async, streaming
JavaScript API.

## Packages

| package | description |
|---|---|
| [`@sysutils/ps`](./packages/ps) | Cross-platform process listing as a Node.js `Readable` stream. |
| `@sysutils/ps-rust` | Native Rust backend for `@sysutils/ps`. |
| `@sysutils/ps-dotnet` | Native .NET backend for `@sysutils/ps`. |

## Layout

```
packages/
  ps/          # Node.js entrypoint (@sysutils/ps)
  ps-rust/     # Rust crate + npm binary package
  ps-dotnet/   # .NET project + npm binary package
.github/
  workflows/   # CI builds for native binaries
.agents/       # Agent rules and skills
docs/adr/      # Architecture decision records
```

## Tooling

- Node.js `>=24` with `npm` workspaces.
- Rust toolchain (for `ps-rust`).
- .NET 8 SDK (for `ps-dotnet`).

## Read-first

1. `AGENTS.md` — the agent contract.
2. `.agents/RULES.md` — rule index for tracked `.md` files.
3. Package `README.md` for the component you are touching.
