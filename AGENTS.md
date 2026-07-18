# Agent Contract

> This file is the single source of truth for how agents (AI or human)
> work in this repository. Read it before any edit.

## 1. Repository purpose

`@sysutils` is a cross-platform, stream-first system utilities monorepo for
Node.js. Each utility ships one or more native backends (Rust, .NET, etc.) and
exposes a single async Node.js API that returns native streams.

This repository is opinionated:

- **Stream-first**: public APIs return `Readable` streams or async iterators,
  not arrays or synchronous lists.
- **Native-by-default**: heavy or OS-specific work is done in prebuilt native
  binaries, not pure Node.js workarounds.
- **Cross-platform**: every package must build and pass tests on Windows,
  macOS, and Linux for `x64` and `arm64`.
- **Monorepo**: source and distribution live in `packages/`. Native source is
  inside its npm package (`packages/ps-rust/Cargo.toml`,
  `packages/ps-dotnet/*.csproj`).

## 2. Read-first order

Before making changes, read in this order:

1. `AGENTS.md` (this file).
2. `.agents/RULES.md` — tracked rule files and who owns them.
3. The package `README.md` for the component you are touching.
4. `docs/adr/` if the change affects architecture or package boundaries.

## 3. Invariants

- **Never commit secrets or tokens.** Not in code, not in `.env`, not in tests.
- **Never ship unbuilt native binaries.** CI must build and package them.
- **Never break the public streaming API** unless an ADR is added and the major
  version is bumped.
- **Prefer existing tooling.** Do not add dependencies unless the package cannot
  be completed without them; if you do add one, pin it and document why.
- **Every bug fix or feature must have a test.** Run `npm test` before opening a
  PR.

## 4. Workflows

### Adding a new utility

1. Open an issue describing the utility, its native backends, and the public
   streaming API.
2. Add `packages/<utility>/`, `packages/<utility>-rust/`, and
   `packages/<utility>-dotnet/` only if needed.
3. Update root `README.md` and this file if the rule changes.
4. Add CI matrix entries in `.github/workflows/ci.yml`.

### Changing a native backend

1. Rebuild the native binary locally and run `npm test`.
2. Update the per-package `binaries.json` or equivalent manifest.
3. Ensure the Node.js wrapper still defaults to a working backend.

### Releasing

1. Use `changeset` to describe the change.
2. CI publishes per-arch npm tarballs.
3. The root `package.json` is private and is not published.

## 5. Agent-specific rules

- `.agents/skills/` contains skills. Use `npx skills add ThePlenkov/skills` to
  refresh shared skills; repository-specific skills live under
  `.agents/skills/<name>/`.
- `.agents/RULES.md` lists every persistent `.md` file and what it governs. If
  you create a new rule document, list it there.

## 6. Common commands

```bash
# install dependencies
npm install

# build all packages
npm run build

# run typecheck across the monorepo
npm run typecheck

# run tests
npm run test

# lint and format
npm run lint
npm run format
```
