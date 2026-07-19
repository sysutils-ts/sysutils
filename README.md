# @sysutils

> Cross-platform, stream-first system utilities for Node.js.

`@sysutils` is a monorepo of small, focused packages that turn slow, fragile,
platform-specific chores into fast, composable, async Node.js streams.

Most Node.js tools that touch the operating system either shell out to
platform commands (`ps`, `tasklist`, `netstat`, `df`) or ship a single blocking
API that materializes everything into memory. `@sysutils` takes a different
shape: **stream-first, native-by-default, and cross-platform by design.**

## Why?

System information is useful in long-running tools, supervisors, CLIs, and
dashboards. Existing packages often make the same trade-offs:

- **They spawn external commands on every call.** That adds fork/exec overhead,
  brittle parsing, and a runtime dependency on the exact version of `ps`,
  `tasklist`, etc.
- **They return everything at once.** Even when you only need one process, one
  network interface, or one disk, you pay the cost of collecting and parsing
  the whole snapshot.
- **They leave out less common platforms.** Windows ARM64, in particular, is
  frequently unsupported or runs through x86/x64 emulation.

`@sysutils` changes the defaults:

- **Stream-first APIs** return `Readable` object-mode streams or async
  iterators, so you can stop early, filter lazily, and pipeline results.
- **Native backends** do the heavy lifting in prebuilt, self-contained binaries
  (or in-process assemblies where appropriate), not by parsing command-line
  output.
- **Cross-platform builds** target Windows, Linux, and macOS on both `x64` and
  `arm64`.
- **Field selection** lets the backend collect only what you asked for, not the
  entire platform snapshot.

## Quick example

```ts
import { listProcesses, createProcessStream } from "@sysutils/ps";

// Convenience collector when you need the full array
const all = await listProcesses();

// Or stream process objects and stop as soon as you find what you need
const stream = createProcessStream({ fields: ["pid", "name"] });
for await (const process of stream) {
  if (process.name === "node") {
    stream.destroy();
    break;
  }
}
```

The same pattern repeats across utilities: a streaming core with optional
collector helpers on top.

## Packages

| package | description |
| --- | --- |
| [`@sysutils/ps`](./packages/ps) | Cross-platform process listing as a Node.js `Readable` stream. |

## Design

Each utility follows the same contract:

1. **One streaming public API** — `createXxxStream()` returns a `Readable`
   object-mode stream or async iterator.
2. **One optional collector** — `listXxx()` awaits the stream and returns an
   array.
3. **Pluggable native backends** — the package picks the safest default and lets
   you opt into faster or more specific backends.
4. **No external command-line dependencies** at runtime.

## Tooling

- Node.js `>=24` with `npm` workspaces.
- .NET 8 SDK (for building the `@sysutils/ps` native backends).

## Read-first

1. `AGENTS.md` — the agent contract.
2. `.agents/RULES.md` — rule index for tracked `.md` files.
3. Package `README.md` for the component you are touching.

## Common commands

```bash
npm install
npm run build
npm run typecheck
npm run test
npm run lint
npm run format
```
