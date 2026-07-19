---
"@sysutils/ps": minor
---

Add a pure-JavaScript `/proc` backend for Linux, field parity aliases, and `toProcessRow()`

- New `proc` backend reads `/proc/<pid>/stat`, `comm`, `status`, `cmdline`, and `exe` directly. It is selected automatically on Linux when the native binaries are not available and avoids `node-api-dotnet` entirely, making it suitable for Bun.
- `ProcessInfo` now exposes `command` (alias for `cmd ?? name`), `startedAt` (Unix epoch ms), and `user` (username or uid string) across all backends.
- `fields: ['pid','ppid','command','user','startedAt']` is normalized end-to-end; unsupported fields return `null` instead of being omitted.
- New `toProcessRow(info)` helper returns a predictable `{ pid, ppid, command, user, startedAt, ... }` shape for supervisors.
