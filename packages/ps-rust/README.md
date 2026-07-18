# @sysutils/ps-rust

Native Rust backend for `@sysutils/ps`.

This package bundles a small Rust binary that enumerates processes using
[`sysinfo`](https://crates.io/crates/sysinfo) and emits one JSON object per line
on `stdout`.

## Building locally

```bash
cd packages/ps-rust
cargo build --release --bin ps
```

## Cross-compilation

Use `cargo-zigbuild` or GitHub Actions matrix builds. Supported targets:

- `x86_64-pc-windows-msvc`
- `aarch64-pc-windows-msvc`
- `x86_64-apple-darwin`
- `aarch64-apple-darwin`
- `x86_64-unknown-linux-gnu`
- `aarch64-unknown-linux-gnu`

## Binary layout

Prebuilt binaries live in `bin/<platform>/<arch>/ps` (or `ps.exe` on Windows).
`binaries.json` maps `process.platform-process.arch` to the correct path.

## API

```js
import { getBinaryPath } from "@sysutils/ps-rust";

const path = getBinaryPath();
```

## See also

- `@sysutils/ps` — Node.js streaming wrapper.
- `@sysutils/ps-dotnet` — alternative .NET backend.
