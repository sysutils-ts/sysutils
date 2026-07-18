# Rule index

This repository uses the `.agents/` framework. The files below are intentionally
tracked by git and must be read by any agent before touching the related area.

| file | scope | owned by |
|---|---|---|
| `AGENTS.md` | repository-wide agent contract | human |
| `.agents/RULES.md` | this index | human |
| `packages/*/README.md` | package-specific API and build notes | package owner |
| `docs/adr/*.md` | architecture decisions | team |

## Repository-specific skills

- `.agents/skills/` is the home for skills that are specific to this repo.
- General shared skills come from `ThePlenkov/skills` via `npx skills add`.

## Adding a rule

1. Write the rule file.
2. Add it to the table above.
3. Never put secrets, tokens, or personal environment data in any rule file.
