# @sysutils/ps-dotnet

Native .NET backend for `@sysutils/ps`.

This package bundles a small .NET console app that enumerates processes and
emits one JSON object per line on `stdout`.

## Building locally

```bash
cd packages/ps-dotnet
dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true
```

## Cross-compilation

Use `dotnet publish -r <RID>` in CI for each runtime identifier:

- `win-x64`
- `win-arm64`
- `linux-x64`
- `linux-arm64`
- `osx-x64`
- `osx-arm64`

Trimmed/self-contained single-file publish keeps the binary small and
runtime-free.

## Binary layout

Prebuilt binaries live in `bin/<platform>/<arch>/ps` (or `ps.exe` on Windows).
`binaries.json` maps `process.platform-process.arch` to the correct path.

## API

```js
import { getBinaryPath } from "@sysutils/ps-dotnet";

const path = getBinaryPath();
```

## See also

- `@sysutils/ps` — Node.js streaming wrapper.
- `@sysutils/ps-rust` — alternative Rust backend.
