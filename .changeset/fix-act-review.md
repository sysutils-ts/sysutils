---
"@sysutils/ps": patch
---

Refine `/proc` backend field selection and invalid-backend error messaging.

- Avoid reading `exe`/`comm` when only `cmd` is requested in the `proc` backend.
- Report the actual invalid backend value in `resolveBackend` instead of a misleading missing-binary message.
