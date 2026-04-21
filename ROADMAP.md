# Roadmap — Git Time Traveller

A VS Code extension that marries git history with LLM-powered narrative. Pick _any_ commit, branch, tag, or stash as the gutter diff baseline, then ask `@historian` _why_ a line changed — grounded in commit messages, PR metadata, and surrounding history.

## Pillars

1. **Dynamic baseline diff** — `QuickDiffProvider` whose baseline is a user-chosen git ref, not just `HEAD`.
2. **Narrative history** — an `@historian` chat participant (using `vscode.lm`) that explains changes in plain English, citing commits and PRs.
3. **Frictionless navigation** — one-click hops between a line's versions across history.
4. **File history panel** — a traditional, always-visible log of how the current file got to now, with one-click hops to any past version.

---

## Phase 0 — Project scaffold

- [x] Extension manifest, TypeScript build, activation events
- [x] Command palette entries (stubs)
- [x] `QuickDiffProvider` registered against a custom `git-time-traveller:` URI scheme
- [x] `@historian` chat participant registered with a placeholder handler
- [x] CI (lint + `vsce package` smoke build)
- [x] Manual test checklist in `CONTRIBUTING.md`

## Phase 1 — Baseline picker (MVP quick diff)

Goal: user can pick a ref once, and the gutter reflects diffs against that ref until cleared.

- [x] Integrate with the built-in `vscode.git` extension API to enumerate refs (branches, tags, commits)
- [x] Stash enumeration — Git extension API doesn't expose it; shelled out via `listStashes` in `src/git/cli.ts` and surfaced in the picker's "Stashes" section
- [x] QuickPick UI: recent commits, branches, tags, "Enter SHA…"
- [x] `TextDocumentContentProvider` that resolves `git-time-traveller:<path>` → file contents at the effective ref
- [x] `QuickDiffProvider.provideOriginalResource` returns the custom URI for the active baseline
- [x] Status bar item showing the active baseline; click to change or clear (now indicates `(file)` when a per-file override is in effect)
- [x] Per-workspace persistence of the chosen baseline
- [x] Fallback when ref is unreachable / file did not exist at that ref — `git show` returns `''`, diff treats as pure-add

## Phase 1.5 — File history panel (MVP)

Goal: a sidebar panel that shows `git log` for the active file in a short format (SHA · subject · author · relative date) and lets the user set any entry as the quick-diff baseline with one click. Parallelizable with Phase 2 once Phase 1's git-extension integration lands.

### Render strategy (pick before starting)

- **A. Dedicated `TreeView`** _(assumed default)_ — `TreeDataProvider` in a custom Activity Bar container. Matches the "traditional" SourceTree/Fork log shape, full control over grouping and inline actions, cleanest integration with baseline + `@historian`.
- **B. `TimelineProvider`** — plugs into VS Code's built-in Timeline view alongside git and local-save sources. Smallest surface area, but less discoverable and styling is out of our hands.
- **C. Webview** — max visual fidelity (graph rendering, avatars, animations). Highest cost and own message-passing layer; keep as an escape hatch.

### Feature set

- [x] View container in the Activity Bar titled "Time Traveller" with a `fileHistory` view
- [x] Auto-follows the active editor; friendly empty state when no file is active, the file is untracked, or outside a repo
- [x] Row label: commit subject. Row description: `<author> · <relative date>`. Row tooltip: short SHA + full body + absolute ISO date.
- [x] Icons per entry kind: normal commit, merge commit, currently-selected baseline, working-tree (synthetic top row when dirty)
- [x] Follows renames (`git log --follow`) and surfaces a "renamed from …" affordance on the first post-rename entry
- [x] Pagination: default page size 50 with a virtual "Load more…" node; clicking it grows the limit and re-renders. Backed by `HistoryCache` so pagination state survives repeated refreshes on the same file
- [x] Grouping toggle: None (default) · By date bucket (Today / Yesterday / This week / This month / This year / Older) · By author — `src/history/filters.ts` + `timeTraveller.history.setGrouping` command
- [x] Story of a commit — right-click a history row → "Tell the story of this commit". Reuses the `@historian` pipeline with a commit-focused `/story` framing and a `git show --numstat` "Files changed" section in the prompt (`showCommitStat` in `src/git/cli.ts`, commit-story branch in `src/historian/prompt.ts`)

### Interactions

- [x] **Primary click** → set that commit as the quick-diff baseline (writes to `BaselineStore`, per-file scope); currently-baseline row is visually marked
- [x] Inline icon: "Open diff vs working tree"
- [x] Inline icon: "Open diff vs previous revision of this file"
- [x] Context menu:
  - [x] Set as baseline (default — per-file) + "Set as workspace baseline" escape hatch
  - [x] Open file at this revision (read-only)
  - [x] Ask `@historian` about this commit
  - [x] Copy commit SHA
  - [x] Copy subject
  - [x] Open on GitHub/GitLab/Bitbucket (when a known remote is present)
- [x] Top-of-view actions: filter, group, clear filters (shown only when filters are active via `timeTraveller.history.hasFilters` context key), ask @historian about file, refresh. Active filter state is shown in the view's description line

### Filters & search

- [x] Text filter on subject + body — `timeTraveller.history.setTextFilter`, case-insensitive substring match
- [ ] Filter by author (multi-select from contributors to this file) — deferred; grouping by author covers most of the "who" use cases for now
- [ ] Filter by date range — deferred
- [x] Toggle "Hide merge commits" — `timeTraveller.history.toggleHideMerges`
- [x] Persist last filter state per workspace — stored under `timeTraveller.history.state` in `workspaceState`

### Data layer

- [x] `src/history/service.ts` — single entry point (`getFileHistory(uri)`) with injectable deps for tests
- [x] Shells `git log --follow --pretty=<custom>` through `src/git/cli.ts`; pairs with `logFileRenames` to annotate rename transitions
- [x] `HistoryEntry`: `{ sha, shortSha, subject, body, authorName, authorEmail, authorDate, isMerge, parents, renamedFrom? }`
- [x] LRU cache keyed by `(repoRoot, relPath, limit)` (`HistoryCache` in `src/history/service.ts`). Invalidates per-repo when `Repository.state.onDidChange` fires (branch switch / HEAD move / fetch / merge), plus a `clear()` path for the explicit Refresh action. Filter dimension will be added when filters land

### View layer

- [x] `src/history/provider.ts` — `TreeDataProvider<HistoryNode>` with node kinds `entry`, `placeholder`, `workingTree`, `loadMore` (group nodes still pending)
- [x] `src/history/view.ts` — wires `vscode.window.createTreeView`, active-editor listener, and commands; re-renders on baseline change so the marker moves
- [x] `package.json` contributions: activity bar view container, `fileHistory` view, commands `timeTraveller.history.{refresh, setBaseline, setAsGlobalBaseline, openDiff, openDiffPrev, openAtRevision, copySha, copySubject, openOnRemote, askBlame, clearFileBaseline}`, and `view/title` + `view/item/context` + `view/item/inline` menu entries

### Integration with the rest of the extension

- [x] `BaselineStore` stays the single source of truth — the panel reads it (to mark the current baseline row) and writes to it (on primary click, per-file scope)
- [x] "Ask `@historian` about this commit" prefills the chat via `workbench.action.chat.open` with the SHA as context. The chat handler still needs a commit-context code path (Phase 3).
- [~] Status bar "Reveal in File History" — free via VS Code's auto-generated `workbench.view.extension.timeTraveller` focus command; explicit command entry still deferred

### Edge cases

- File not in any repository → placeholder with a hint
- Multi-root workspaces → resolve repo from the active editor's workspace folder
- Working-tree changes present → synthetic top row "● Working tree (uncommitted changes)" when `git diff --quiet` fails
- Binary files → log works; diff actions degrade to "Open at revision" only
- Huge histories (>5k file commits) → cap initial page, rely on "Load more"
- Detached HEAD / stash / shallow clone → still render; annotate HEAD row accordingly

### Exit criteria

- [ ] Opening any tracked file populates the panel within 300 ms for repos with ≤10k commits touching that file — needs measurement in a real Extension Host; pagination (50 per page) + `HistoryCache` make the architecture plausible but it isn't verified
- [x] Clicking a row updates gutter diff in the active editor without reloading the document — `BaselineStore.setForFile` fires a tagged `BaselineChange`, `TimeTravellerQuickDiff` refires `onDidChange` for the matching live-baseline URI, and VS Code re-reads fresh content in place
- [x] "Ask @historian about this commit" lands in chat with the SHA already in the prompt — `timeTraveller.history.askHistorian` (and `.storyOfCommit`) prefill via `workbench.action.chat.open`; `extractShaMention` picks it up on the other side
- [x] Panel survives branch switches, merges, rebases, and stashes without stale entries — each open repo's `state.onDidChange` calls `HistoryProvider.invalidateAndRefresh(repoRoot)` so the cache is busted for that repo when HEAD moves

## Phase 2 — Multi-baseline & scoping

- [x] Per-file baseline overrides (e.g. compare `src/foo.ts` against `main`, but `src/bar.ts` against a stash) — `BaselineStore.setForFile` + tagged `BaselineChange` event; live-baseline TT URIs carry no query so per-file changes re-read fresh content
- [x] "Compare working tree to merge-base with `<branch>`" preset — auto-detects `main`/`master`/`develop`/`trunk` (local, falling back to `origin/`) and computes `git merge-base HEAD <target>` on pick
- [x] "Compare to last release tag" preset — `latestReleaseTag` in `src/semver.ts`, surfaced in the picker's Scopes section
- [x] "Stepping" commands: move baseline ±1 commit along `git log -- <file>` — `timeTraveller.stepBaselineBackward` / `.stepBaselineForward`, writes to the per-file slot
- [x] Diff editor shortcut: open `git-time-traveller:` URI side-by-side — `timeTraveller.openDiffWithBaseline`

## Phase 3 — `@historian` chat participant (narrative history)

Goal: ask `@historian` about a line, range, or file and get a _why_, not just a _who_.

- [x] Handler reads the active selection / cursor position from the chat context
- [x] Gather evidence: `git blame -w` on the selected range, `git log --follow` on the file (default + `/since <ref>` + `/author <pattern>` variants), commit bodies
- [ ] Parent-diff snippets — deferred; current evidence relies on commit bodies only
- [ ] Fetch PR context when a remote is GitHub/GitLab (commit → PR → body + review comments) — deferred, needs `vscode.authentication` + API client
- [x] Prompt template that includes selection excerpt + blame-by-SHA rollup + referenced commits + file log
- [x] Stream response with `vscode.ChatResponseStream`; emit `stream.reference(uri)` for each cited commit (via `makeTimeTravellerUri`)
- [x] Slash commands:
  - [x] `/why` — explain why the selected lines changed
  - [x] `/story` — narrative timeline of a file or symbol
  - [x] `/since <ref>` — focus on changes since a ref
  - [x] `/author <pattern>` — filter the history to one author (pattern matches git's `--author=` regex against name+email)
- [x] Follow-up suggestions (`followupProvider`) for drill-down — cross-command and blame-aware

## Phase 4 — Inline UX

- [x] CodeLens above each hunk: "Ask @historian why this changed" — `src/codeLens.ts`, backed by pure `parseDiffHunks` + `codeLensLineForHunk`. Click selects the hunk's lines and opens `@historian` with a `why is this the way it is?` seed prompt. Gated by `timeTraveller.codeLens.enabled` (default true).
- [ ] Gutter hover: top-of-mind commit message, author, PR link — deferred; needs caching + staleness handling
- [ ] Inline chat entry point via `vscode.chat` `participantDetected` API — deferred; API needs investigation
- [ ] Decoration of churn hotspots (lines that have changed N+ times since baseline) — deferred

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
