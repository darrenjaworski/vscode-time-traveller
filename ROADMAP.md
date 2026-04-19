# Roadmap — Git Time Traveller

A VS Code extension that marries git history with LLM-powered narrative. Pick _any_ commit, branch, tag, or stash as the gutter diff baseline, then ask `@blame` _why_ a line changed — grounded in commit messages, PR metadata, and surrounding history.

## Pillars

1. **Time-travel quick diff** — `QuickDiffProvider` whose baseline is a user-chosen git ref, not just `HEAD`.
2. **Narrative blame** — a `@blame` chat participant (using `vscode.lm`) that explains changes in plain English, citing commits and PRs.
3. **Frictionless navigation** — one-click hops between a line's versions across history.

---

## Phase 0 — Project scaffold

- [x] Extension manifest, TypeScript build, activation events
- [x] Command palette entries (stubs)
- [x] `QuickDiffProvider` registered against a custom `git-time-traveller:` URI scheme
- [x] `@blame` chat participant registered with a placeholder handler
- [ ] CI (lint + `vsce package` smoke build)
- [ ] Manual test checklist in `CONTRIBUTING.md`

## Phase 1 — Baseline picker (MVP quick diff)

Goal: user can pick a ref once, and the gutter reflects diffs against that ref until cleared.

- [ ] Integrate with the built-in `vscode.git` extension API to enumerate refs (branches, tags, commits, stashes)
- [ ] QuickPick UI: recent commits, branches, tags, stashes, "Enter SHA…"
- [ ] `TextDocumentContentProvider` that resolves `git-time-traveller:<ref>/<path>` → file contents at that ref
- [ ] `QuickDiffProvider.provideOriginalResource` returns the custom URI for the active baseline
- [ ] Status bar item showing the active baseline; click to change or clear
- [ ] Per-workspace persistence of the chosen baseline
- [ ] Fallback when ref is unreachable / file did not exist at that ref

## Phase 2 — Multi-baseline & scoping

- [ ] Per-file baseline overrides (e.g. compare `src/foo.ts` against `main`, but `src/bar.ts` against a stash)
- [ ] "Compare working tree to merge-base with `<branch>`" preset
- [ ] "Compare to last release tag" preset
- [ ] "Stepping" commands: move baseline ±1 commit along `git log -- <file>`
- [ ] Diff editor shortcut: open `git-time-traveller:` URI side-by-side

## Phase 3 — `@blame` chat participant (narrative history)

Goal: ask `@blame` about a line, range, or file and get a _why_, not just a _who_.

- [ ] Handler reads the active selection / cursor position from the chat context
- [ ] Gather evidence: `git blame -w --follow`, `git log -L`, commit bodies, parent diffs
- [ ] Fetch PR context when a remote is GitHub/GitLab (commit → PR → body + review comments)
- [ ] Prompt template that includes code excerpt + commit trail + PR summaries
- [ ] Stream response with `vscode.ChatResponseStream`; include `Reference`s to the commits
- [ ] Slash commands:
  - `/why` — explain why the selected lines changed
  - `/story` — narrative timeline of a file or symbol
  - `/blame-since <ref>` — focus on changes since a ref
  - `/author <name>` — filter the history to one author
- [ ] Follow-up suggestions (`ChatFollowup`) for drill-down

## Phase 4 — Inline UX

- [ ] CodeLens above each hunk: "Ask @blame why this changed"
- [ ] Gutter hover: top-of-mind commit message, author, PR link
- [ ] Inline chat entry point via `vscode.chat` `participantDetected` API
- [ ] Decoration of churn hotspots (lines that have changed N+ times since baseline)

## Phase 5 — Polish & distribution

- [ ] Settings:
  - default baseline strategy (`HEAD`, `merge-base(main)`, `last-tag`, `custom`)
  - LLM model preference (via `vscode.lm.selectChatModels`)
  - max context tokens for blame evidence
  - PR provider auth (GitHub token via VS Code auth provider)
- [ ] Telemetry opt-in (counts only, no content)
- [ ] Walkthrough (`contributes.walkthroughs`) for first-run onboarding
- [ ] Marketplace listing: icon, screenshots, animated gif
- [ ] Publish to Open VSX as well as the VS Code Marketplace

## Phase 6 — Stretch ideas

- [ ] Stash browser with preview diffs against the current baseline
- [ ] "Time-lapse" scrubber: drag a slider across commits and watch the file mutate
- [ ] Export a `/story` transcript to a markdown changelog entry
- [ ] Workspace-wide "what changed and why" digest over a date range
- [ ] Support Jujutsu (`jj`) in addition to git

---

## Non-goals (for now)

- Replacing the built-in SCM view or git extension
- Hosting our own LLM — we use whatever `vscode.lm` exposes
- Editing history (rebase, cherry-pick, commit) — read-only
- Non-git VCS beyond the stretch goal above

## Key APIs

- `vscode.scm.createSourceControl` + `QuickDiffProvider.provideOriginalResource`
- `vscode.workspace.registerTextDocumentContentProvider`
- `vscode.chat.createChatParticipant`, `ChatRequestHandler`, `ChatResponseStream`
- `vscode.lm.selectChatModels`, `LanguageModelChatMessage`
- `vscode.extensions.getExtension('vscode.git').exports` (Git extension API)
- `vscode.authentication.getSession('github', …)` for PR context
