# @sysutils

Cross-platform, stream-first system utilities for Node.js.

`@sysutils` is a monorepo of small, focused packages that expose OS-level
information (processes, network, disks, etc.) through Node.js streams. Each
utility ships its own native backend(s) and exposes a single async, streaming
JavaScript API.

## Packages

| package                 | description                                                    |
| ----------------------- | -------------------------------------------------------------- |
| [`@sysutils/ps`](./packages/ps) | Cross-platform process listing as a Node.js `Readable` stream. |

## Layout

```
packages/
  ps/                   # @sysutils/ps package
    src/                # TypeScript entrypoint and tests
    native/cli/         # .NET AOT CLI backend source
    native/nodeapi/     # in-process .NET backend source via node-api-dotnet
    native/tests/       # .NET unit tests
    scripts/            # native build helpers
    bin/                # published native binaries (ignored in git)
    dist/               # TypeScript bundle (ignored in git)
    binaries.json       # backend binary manifest
.github/
  workflows/            # CI builds for native binaries
.agents/                # Agent rules and skills
docs/adr/               # Architecture decision records
```

## Tooling

- Node.js `>=24` with `npm` workspaces.
- .NET 8 SDK (for building the `@sysutils/ps` native backends).

## Read-first

1. `AGENTS.md` — the agent contract.
2. `.agents/RULES.md` — rule index for tracked `.md` files.
3. Package `README.md` for the component you are touching.
