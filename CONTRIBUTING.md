# Contributing to @sysutils

Contributions are welcome. Please open an issue or pull request in the
[sysutils-ts/sysutils](https://github.com/sysutils-ts/sysutils) repository.

## Development setup

This monorepo uses `npm` workspaces and requires Node.js `>=24`.

```bash
npm install
npm run typecheck
npm run build:cli -w packages/ps       # native AOT CLI binary
npm run build:nodeapi -w packages/ps   # node-api-dotnet assembly
npm run build -w packages/ps           # TypeScript bundle
npm run test
npm run lint
```

> The `build:cli` and `build:nodeapi` steps require the .NET 10 SDK and can be
> skipped if you only need the pure-JS `/proc` backend on Linux.

To cross-compile all supported RIDs (requires .NET 10 SDK):

```bash
npm run build:all -w packages/ps
```

## Native source

- `packages/ps/native/cli/` — .NET AOT CLI backend source.
- `packages/ps/native/nodeapi/` — in-process `node-api-dotnet` backend source.

See each package `README.md` for usage and the `docs/adr/` directory for
architecture decisions.
