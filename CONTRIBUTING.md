# Contributing to @sysutils

Contributions are welcome. Please open an issue or pull request in the
[sysutils-ts/sysutils](https://github.com/sysutils-ts/sysutils) repository.

## Development setup

This monorepo uses `npm` workspaces and requires Node.js `>=24`.

```bash
npm install
npm run typecheck
npm run build
npm run test
npm run lint
```

`npm run build` bundles the TypeScript entrypoints. To build the `@sysutils/ps`
native backends for the current platform:

```bash
npm run build:cli       # native AOT CLI binary
npm run build:nodeapi   # node-api-dotnet assembly
npm run build           # TypeScript bundle
```

To cross-compile all supported RIDs (requires .NET 10 SDK):

```bash
npm run build:all
```

## Native source

- `packages/ps/native/cli/` — .NET AOT CLI backend source.
- `packages/ps/native/nodeapi/` — in-process `node-api-dotnet` backend source.

See each package `README.md` for usage and the `docs/adr/` directory for
architecture decisions.
