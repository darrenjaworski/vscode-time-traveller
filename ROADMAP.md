# Roadmap — Git Time Traveller

A VS Code extension that marries git history with LLM-powered narrative. Pick _any_ commit, branch, tag, or stash as the gutter diff baseline, then ask `@blame` _why_ a line changed — grounded in commit messages, PR metadata, and surrounding history.

## Pillars

1. **Time-travel quick diff** — `QuickDiffProvider` whose baseline is a user-chosen git ref, not just `HEAD`.
2. **Narrative blame** — a `@blame` chat participant (using `vscode.lm`) that explains changes in plain English, citing commits and PRs.
3. **Frictionless navigation** — one-click hops between a line's versions across history.
4. **File history panel** — a traditional, always-visible log of how the current file got to now, with one-click hops to any past version.

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

- [x] Integrate with the built-in `vscode.git` extension API to enumerate refs (branches, tags, commits)
- [ ] Stash enumeration — Git extension API doesn't expose it; needs a `git stash list` CLI fallback
- [x] QuickPick UI: recent commits, branches, tags, "Enter SHA…"
- [x] `TextDocumentContentProvider` that resolves `git-time-traveller:<path>` → file contents at the effective ref
- [x] `QuickDiffProvider.provideOriginalResource` returns the custom URI for the active baseline
- [x] Status bar item showing the active baseline; click to change or clear (now indicates `(file)` when a per-file override is in effect)
- [x] Per-workspace persistence of the chosen baseline
- [x] Fallback when ref is unreachable / file did not exist at that ref — `git show` returns `''`, diff treats as pure-add

## Phase 1.5 — File history panel (MVP)

Goal: a sidebar panel that shows `git log` for the active file in a short format (SHA · subject · author · relative date) and lets the user set any entry as the quick-diff baseline with one click. Parallelizable with Phase 2 once Phase 1's git-extension integration lands.

### Render strategy (pick before starting)

- **A. Dedicated `TreeView`** _(assumed default)_ — `TreeDataProvider` in a custom Activity Bar container. Matches the "traditional" SourceTree/Fork log shape, full control over grouping and inline actions, cleanest integration with baseline + `@blame`.
- **B. `TimelineProvider`** — plugs into VS Code's built-in Timeline view alongside git and local-save sources. Smallest surface area, but less discoverable and styling is out of our hands.
- **C. Webview** — max visual fidelity (graph rendering, avatars, animations). Highest cost and own message-passing layer; keep as an escape hatch.

### Feature set

- [ ] View container in the Activity Bar titled "Time Traveller" with a `fileHistory` view (decide during build whether to host inside the SCM view instead)
- [ ] Auto-follows the active editor; friendly empty state when no file is active, the file is untracked, or outside a repo
- [ ] Row label: commit subject. Row description: `<author> · <relative date>`. Row tooltip: short SHA + full body + absolute ISO date.
- [ ] Icons per entry kind: normal commit, merge commit, current HEAD, currently-selected baseline, tagged, working-tree (synthetic top row if dirty)
- [ ] Follows renames (`git log --follow`) and surfaces a "renamed from …" affordance on the first post-rename entry
- [ ] Pagination: default page size 50, hard cap initial load at 200, virtual "Load more" node at the end
- [ ] Grouping toggle: None (default) · By date bucket (Today / This week / Older) · By author

### Interactions

- [ ] **Primary click** → set that commit as the quick-diff baseline (writes to `BaselineStore`); currently-baseline row is visually marked
- [ ] Inline icon: "Open diff vs working tree" (uses the `git-time-traveller:` scheme already registered)
- [ ] Inline icon: "Open diff vs previous revision of this file"
- [ ] Context menu:
  - Set as baseline (default)
  - Open file at this revision (read-only)
  - Ask `@blame` about this commit
  - Copy commit SHA
  - Copy subject
  - Open on GitHub/GitLab (when a known remote is present)
- [ ] Top-of-view actions: refresh, toggle merge commits, change grouping, clear filters

### Filters & search

- [ ] Text filter on subject + body
- [ ] Filter by author (multi-select from contributors to this file)
- [ ] Filter by date range
- [ ] Toggle "Hide merge commits"
- [ ] Persist last filter state per workspace

### Data layer

- [ ] `src/history/historyService.ts` — single entry point: given a file URI, returns a paged async iterable of `HistoryEntry`s
- [ ] Prefers the built-in Git extension API (`Repository.log()`) where it suffices; falls back to `src/git.ts` shelling `git log --follow --pretty=<custom>` for fields the API doesn't expose
- [ ] `HistoryEntry`: `{ sha, shortSha, subject, body, authorName, authorEmail, authorDate, isMerge, parents, renamedFrom? }`
- [ ] LRU cache keyed by `(repoRoot, relPath, pageCursor, filters)`; invalidates on branch switch / HEAD move / fetch via git extension events

### View layer

- [ ] `src/history/historyProvider.ts` — `TreeDataProvider<HistoryNode>` with node kinds `entry`, `group`, `loadMore`, `placeholder`, `workingTree`
- [ ] `src/history/historyView.ts` — wires `vscode.window.createTreeView`, active-editor listener, filter state, and commands; handles `onDidChangeTreeData` on baseline change so the marker moves
- [ ] `package.json` contributions:
  - `viewsContainers.activitybar[]` → `timeTraveller`
  - `views["timeTraveller"][]` → `timeTraveller.fileHistory`
  - commands: `timeTraveller.history.{refresh,setBaseline,openDiff,openDiffPrev,openAtRevision,copySha,copySubject,openOnRemote,askBlame,toggleMerges,groupBy,filter}`
  - `menus` entries for `view/title`, `view/item/context`, `view/item/inline`

### Integration with the rest of the extension

- `BaselineStore` stays the single source of truth — the panel reads it (to mark the current baseline row) and writes to it (on primary click)
- "Ask `@blame` about this commit" prefills the chat via `vscode.commands.executeCommand('workbench.action.chat.open', …)` with the SHA as context; the existing chat handler gains a commit-context branch
- Status bar baseline label gains a "Reveal in File History" action

### Edge cases

- File not in any repository → placeholder with a hint
- Multi-root workspaces → resolve repo from the active editor's workspace folder
- Working-tree changes present → synthetic top row "● Working tree (uncommitted changes)" when `git diff --quiet` fails
- Binary files → log works; diff actions degrade to "Open at revision" only
- Huge histories (>5k file commits) → cap initial page, rely on "Load more"
- Detached HEAD / stash / shallow clone → still render; annotate HEAD row accordingly

### Exit criteria

- [ ] Opening any tracked file populates the panel within 300 ms for repos with ≤10k commits touching that file
- [ ] Clicking a row updates gutter diff in the active editor without reloading the document
- [ ] "Ask @blame about this commit" lands in chat with the SHA already in the prompt
- [ ] Panel survives branch switches, merges, rebases, and stashes without stale entries

## Phase 2 — Multi-baseline & scoping

- [x] Per-file baseline overrides (e.g. compare `src/foo.ts` against `main`, but `src/bar.ts` against a stash) — `BaselineStore.setForFile` + tagged `BaselineChange` event; live-baseline TT URIs carry no query so per-file changes re-read fresh content
- [x] "Compare working tree to merge-base with `<branch>`" preset — auto-detects `main`/`master`/`develop`/`trunk` (local, falling back to `origin/`) and computes `git merge-base HEAD <target>` on pick
- [ ] "Compare to last release tag" preset — deferred, needs semver-aware tag sort
- [x] "Stepping" commands: move baseline ±1 commit along `git log -- <file>` — `timeTraveller.stepBaselineBackward` / `.stepBaselineForward`, writes to the per-file slot
- [x] Diff editor shortcut: open `git-time-traveller:` URI side-by-side — `timeTraveller.openDiffWithBaseline`

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
