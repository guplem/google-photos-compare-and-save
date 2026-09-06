# AGENTS.md map with Claude-Code-only skills, subagents, and ADRs

## Context

This repository started as a plain extension folder with a standalone `CLAUDE.md` that mixed architecture facts, coding rules, gotchas, and a short "how to add a feature" procedure in one always-loaded file. Nothing else guided an agent: no subagents, no ADRs, no permissions file, and no automatic checks.

This repo adopts a shared personal standard: a root `AGENTS.md` as the always-loaded map, on-demand skills, subagents for delegated checks, and living ADRs. The repo is developed with Claude Code only, so no multi-tool sync machinery is needed.

## Decision

- `AGENTS.md` at the repo root is the canonical, always-loaded map. `CLAUDE.md` is a one-line `@AGENTS.md` shim so Claude Code loads it. Tools that read `AGENTS.md` natively work without extra files.
- Areas that earn their own doc follow the same pattern: `<area>/AGENTS.md` holds the content, next to a one-line `<area>/CLAUDE.md` shim that makes Claude Code load it on demand. A nested `AGENTS.md` without its shim never loads. Today only `adr/` earns one; the source tree is small enough that the root map covers it.
- Skills live committed directly at `.claude/skills/<name>/SKILL.md`. No `.agents/skills/` canonical tree, no gitignored mirror, no sync scripts.
- All skills are model-invocable (no `disable-model-invocation` frontmatter). The set is small, so the startup-context cost of their descriptions is low.
- Subagents live at `.claude/agents/<name>.md`: `pattern-scout`, `adr-checker`, `validate`, and `docs-checker`.
- ADRs live in this single `adr/` directory, indexed as one-line rows in the root `AGENTS.md`, and are living documents updated in place. The folder's conventions live in `adr/AGENTS.md`, auto-loaded via its `adr/CLAUDE.md` shim.
- `.claude/settings.json` holds the permission allow/ask lists and the PostToolUse hooks.

**Rejected alternative:** keep the standalone `CLAUDE.md` with the procedures inline. Only Claude Code reads that filename, so a second agent tool would see nothing, and an always-loaded procedure costs attention on every session even when the task never touches it.

## Consequences

**Positive:**

- One canonical copy of each instruction; the always-on context stays small because procedures load on demand as skills.
- No sync scripts or mirrors to maintain.

**Trade-offs and follow-up:**

- Skills, subagents, and settings are Claude-Code-only surfaces. If another agent tool is adopted, move skills to a canonical `.agents/skills/` tree with a gitignored `.claude/skills/` mirror and a sync script.
- If the number of skills grows enough that their always-loaded descriptions bloat startup context, add `disable-model-invocation: true` to the human-invoked ones and introduce an `/invoke` chaining skill.
