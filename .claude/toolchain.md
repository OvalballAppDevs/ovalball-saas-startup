# Ovalball — working toolchain

How installed skills, agents, plugins and MCP servers are used on Ovalball work. They are
advisers and workflows, never product authority: CLAUDE.md, the locked owner decisions in
memory, and the canonical database/domain win every conflict. If a skill recommends
something that contradicts an established Ovalball decision, the decision stands unless
the owner changes it.

## Choosing tools

Before substantial work, pick the smallest combination that materially improves the
result. Most small changes need none. Never invoke a tool because it exists, and do not
narrate tool use ("I used X, then Y") — mention one only when knowing it was used helps
the owner read the result.

| Work | Consider | Notes |
|---|---|---|
| New feature / product slice | `superpowers:brainstorming` or `superpowers:writing-plans` for multi-step work; `grilling` only when requirements are genuinely ambiguous | Existing locked decisions are not re-litigated. |
| Bug / failing test | `diagnosing-bugs` or `superpowers:systematic-debugging` for hard faults; `tdd` when a regression test should lead | Fix within the slice; out-of-scope defects are documented, not fixed in passing. |
| Mobile or web UI | `frontend-design` then `ui-ux-pro-max` (see UI/UX below); `impeccable` for critique/audit/polish | Measure rendering on the simulator — never infer from CSS. |
| Domain / architecture | `domain-modeling`, `codebase-design` | Canonical one-model rules in CLAUDE.md take precedence. |
| Second opinion on a risky diff | `codex:rescue` / Codex review (the stop-time review gate is enabled) | Weigh findings; do not apply blindly. |
| Research | Repo first; NotebookLM when its notebooks hold relevant material; `research` for primary sources | See source-of-truth order below. |
| Deployment / infrastructure | Cloudflare or Vercel tooling only when the task concerns those systems | Never deploy or push without explicit authorisation. |
| Durable knowledge | claude-obsidian (see Obsidian below) | Selective, not a transcript. |

Owner-invoked only (their authors disable model invocation — suggest them, do not try to
call them): `/to-spec`, `/to-tickets`, `/implement`, `/implement-spec`, `/grill-me`,
`/grill-with-docs`, `/handoff`, `/claude-handoff`, `/wayfinder`, `/triage`, `/retro`,
`/improve-codebase-architecture`. Suggest `/handoff` when a large slice will continue in
another session, and `/grill-me` when the owner is still forming a plan. `/to-spec`,
`/to-tickets` and `/triage` need `/setup-matt-pocock-skills` run once first (issue
tracker not yet configured).

## Source-of-truth order

1. The current repository and working tree.
2. The canonical database/domain implementation.
3. CLAUDE.md, this file, and locked owner decisions in memory.
4. Durable Ovalball knowledge in the Obsidian vault.
5. External/reference research (NotebookLM, web, documentation).

When two of these disagree, stop and surface the conflict; never silently prefer a lower
source.

## Obsidian (claude-obsidian)

- Each developer selects their own vault through `CLAUDE_OBSIDIAN_VAULT` in their
  machine-local `.claude/settings.local.json`; no vault path belongs in shared files. The
  Ovalball repository is NOT a vault: never run `init` or `adopt` against it, and never
  create a `.claude-obsidian.json` inside it.
- Worth keeping: architecture and canonical-model decisions, authority and safeguarding
  rules, mobile design-system decisions, migration architecture, implementation
  milestones, important technical discoveries, known hardening debt — anything a future
  session would otherwise rediscover.
- Not worth keeping: conversation transcripts, routine implementation detail, temporary
  debugging output. Never store passwords, cookies, tokens, secrets or personal
  authentication data.
- Before a major architectural assumption, query the vault (`/claude-obsidian:wiki-query`)
  when it would prevent contradiction or duplicated discovery. After a genuinely durable
  decision, consider saving it (`/claude-obsidian:save`, `/claude-obsidian:wiki-ingest`).
  Vault writes go through the plugin's preview-then-apply transactions.
- Auto-memory remains the place for working rules about how to collaborate; the vault is
  for product and architecture knowledge.

## NotebookLM (MCP server `notebooklm`)

Use it when a notebook holds research relevant to the task: reference material,
governing-body sources, supplied product research. It is never the source of truth for
how Ovalball currently works. Do not query it gratuitously; never print its
authentication data or re-authenticate when it is already connected.

## UI/UX

For meaningful new mobile or web UI: `frontend-design` for direction, `ui-ux-pro-max` for
accessibility and interaction review, `impeccable` for a bounded critique/polish pass.
They refine the established Ovalball identity; they never replace it:

- deep forest structural chrome; warm chalk content canvas; white/chalk cards; pale mint
  supporting surfaces; bright green only for primary actions and active accents;
- generous rounded corners, spacious native layouts, restrained status colour, rugby
  photography where it earns its place, real club crests for club identity;
- purpose-built mobile, never a desktop layout squeezed onto a phone.

Avoid generic SaaS dashboards, admin tables where a list or card reads better,
everything-green screens, decorative gradients, pill overload, and touch targets under
44pt. Mobile screens use the shared primitives named in CLAUDE.md.

## Delivery mode — product implementation / UI-UX sprint

Prioritise visible product progress with risk-based verification:

- **GREEN** (copy, layout, isolated UI): typecheck/build plus a quick targeted proof.
- **AMBER** (behaviour, flows, contracts): the relevant permanent test, the happy path,
  and one meaningful negative case.
- **RED** (authority, RLS, safeguarding, payments, destructive actions, migrations):
  focused security/authority proof immediately; a slice adding a migration needs its
  clean boot before it is called verified.

Full release certification, full regression, persona matrices and browser sweeps happen
before production, not after every slice.

## Repository safety

The working tree is authoritative. Never reset, restore, checkout away, stash, clean,
push, deploy or merge without explicit authorisation. Never touch the protected untracked
logos or the parked looking-for-opposition migration. Never expose secrets or
authentication data.
