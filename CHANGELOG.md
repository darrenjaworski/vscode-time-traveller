# Changelog

All notable changes to this extension are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the release workflow extracts the section matching the tag version (e.g. `v0.1.0` → `## [0.1.0]`).

## [Unreleased]

### Added

- **Multi-turn conversation.** `@historian` now remembers prior responses in the chat thread, so follow-up questions like "now focus on 2023" or "show me the blame for this section" stay grounded in earlier context.
- **Baseline context in the prompt.** When you've picked a diff baseline, `@historian` now knows what it is and can reference it in its responses — "since your baseline is main, the changes are…"
- **Request-model picker integration.** `@historian` now respects VS Code's built-in model selection (gear icon in the chat panel) instead of requiring custom configuration. Pick your preferred model once, and the extension uses it.

### Changed

- Removed `timeTraveller.chat.modelVendor` and `timeTraveller.chat.modelFamily` settings — use VS Code's chat model picker instead.
- System prompt is now sent with proper System message role for better model instruction adherence.
- Followup suggestions now work correctly (were broken in 1.0.0).

## [1.0.0] - 2026-04-21

First stable release on the VS Code Marketplace. Everything you need to ask `@historian` why a line changed, set any commit as your gutter baseline, and browse a file's history without leaving the editor — packaged with a first-run walkthrough and PR context.

### Added

- **First-run walkthrough.** A four-step "Get started with Git Time Traveller" opens automatically on install: ask `@historian`, pick a diff baseline, browse file history, and (optionally) sign in to GitHub for PR context. Each step has a markdown reference card you can reopen anytime from the Welcome page.
- **Model selection and token budget.**
  - Use VS Code's chat model picker to select which LLM `@historian` asks (ChatGPT, Claude, Gemini, etc.)
  - `timeTraveller.chat.maxBlameEvidenceTokens` (default `4000`) — soft cap on patch/diff evidence per query. Lower it if you hit model context limits.
- **PR context toggle.** `timeTraveller.pr.enabled` (default `true`) — flip off to skip GitHub PR lookups for offline or privacy-sensitive work.
- **Animated demo in the README** showing an end-to-end `@historian` query.

### Changed

- README leads with the demo gif, documents the chat features, and points at the VS Code Marketplace listing.

## [0.3.0] - 2026-04-20

Phase 1.5 (file history panel) and Phase 3 (`@historian`) are now complete. The history panel grows up — pagination, filters, grouping, persisted state — and `@historian` answers are substantially better-grounded thanks to parent-diff snippets, per-commit file stats, and GitHub PR context.

### Added

**File history panel**

- **Pagination.** Initial page of 50 commits with a virtual "Load more…" row that grows the limit in-place.
- **LRU cache** keyed by `(repoRoot, relPath, limit)`, invalidated per-repo on `Repository.state.onDidChange` so branch switches, HEAD moves, fetches, and merges bust stale entries automatically.
- **Text filter** against subject + body (case-insensitive); **hide-merge-commits toggle**; **grouping** by None / By date (Today / Yesterday / This week / This month / This year / Older) / By author. Group nodes expand by default with a count badge.
- **Active filter state** shown in the tree view's description line; a `timeTraveller.history.hasFilters` context key gates the "Clear filters" title action. All state persists per-workspace under `timeTraveller.history.state`.
- **"Tell the story of this commit"** context-menu action on any history row. Prefills `@historian /story <sha>` and triggers the new commit-focused narrative mode.

**`@historian`**

- **Parent-diff snippets.** Cited commits now carry a trimmed `git show --patch` excerpt into the prompt as a `diff` code block. Commit-focused queries pull the full commit (4k chars / 200 lines); `/why` and default mode pull per-file patches for the top 3 blame-cited commits (2k / 80 each). Pure `trimPatch` / `stripDiffBanners` in `src/historian/diff.ts` drop noisy `diff --git` / `index` banners and cap on char + line budgets.
- **Per-commit file stats** via `git show --numstat`. Commit-focused queries get a "Files changed in `<shortSha>`" section (capped at 20 files, binaries called out).
- **GitHub PR context.** For repos with a GitHub remote, `@historian` looks up PRs associated with cited commits and surfaces title + body in a "Pull requests" section. Uses `vscode.authentication.getSession('github', ['repo'], { silent, createIfNone: false })` so it never prompts the user; unauthenticated calls still work against public repos (rate-limited). Session-scoped `PRCache` with a null sentinel for known-absent commits. Capped at 5 commits per query. When GitHub returns multiple PRs for a commit (cherry-picks), prefers the merged one.
- **Commit-focused `/story` mode.** `/story` + a referenced SHA swaps in a commit-focused task ("what motivated it, what it changed, how it fits in") instead of a file-wide timeline, and uses the surrounding file log as context rather than the primary subject.

**Engineering**

- `CONTRIBUTING.md` with a dev-loop summary and a manual test checklist covering every contribution point.
- New modules: `src/history/filters.ts`, `src/historian/diff.ts`, `src/pr/github.ts`, `src/pr/cache.ts`, `src/pr/service.ts` — all pure where possible; network and `vscode` touch points isolated and injectable for tests.
- Test count: 272 tests across 23 files (from 196 across 18 in 0.2.2).

### Changed

- `HistoryContext` now carries `{ entries, hasMore, limit }` instead of just `entries`; pagination state lives in the provider, backed by the cache.
- `Evidence` grew `commitFiles`, `commitDiffs`, and `commitPRs` maps, all keyed by full SHA.
- `HistoryProvider.refresh` preserves `currentLimit` across explicit refreshes of the same file so "Load more" state survives reloads; switching files resets to the first page.

### Deferred

- Author multi-select and date-range filters (grouping-by-author covers most of the "who" use cases for now).
- GitLab and Bitbucket PR providers; Enterprise GitHub; PR review comments.
- Exit-criteria measurement: the 300 ms load budget for ≤10k-commit files needs a real Extension Host run.

## [0.2.2] - 2026-04-19

### Fixed

- `@historian` no longer includes a spurious `lines N–N` reference in the prompt when no text is selected. An empty cursor now produces file-level context (`File: <path>`) instead of fabricating a single-line selection from the cursor position.

### Changed

- README rewritten to lead with `@historian` — usage examples and slash-command table appear before the baseline/history features.

## [0.2.1] - 2026-04-19

### Added

- Marketplace icon — 128×128 PNG rendered from the `git-historian.svg` artwork.

## [0.2.0] - 2026-04-19

Phase 4 Inline UX lands — the gutter now has in-editor affordances, not just decorations. The chat participant is renamed to something that actually describes what it does.

### Changed

- **The chat participant is now `@historian`** (was `@blame`). The old name implied attribution only; the new name matches what we actually do — narrate git history, explain why code changed, walk the story. Slash command `/blame-since` also renamed to `/since`. Internal refactor: `src/blame/` moved to `src/historian/`, types and command IDs updated to match. No API stability implied by the old name — we hadn't published to Marketplace yet.

### Added

- **Hover on changed lines** shows the last-touching commit (subject · shortSha · author · date), but only on lines that are changed relative to the current baseline. Toggle via `timeTraveller.hover.enabled` (default on).
- **CodeLens above each hunk** in the gutter diff: `$(comment-discussion) Ask @historian why this changed`. Clicking it selects the hunk's lines and opens the chat with `@historian why is this the way it is?`. Toggle via `timeTraveller.codeLens.enabled` (default on).
- **Stash enumeration** in the baseline picker — new "Stashes" section backed by `git stash list`.
- **"Last release" preset** in the picker's Scopes section — picks the newest stable semver tag (`v`-prefix tolerated, prereleases ignored, numeric comparison so `v1.10.0` beats `v1.9.0`).
- **`timeTraveller.defaultBaseline`** is now consumed: QuickDiff's ref resolution falls through to this setting when no stored baseline is present, so you can pin the workspace to `origin/main` and forget about it.
- New settings `timeTraveller.codeLens.enabled` and `timeTraveller.hover.enabled` for the Phase 4 toggles.

## [0.1.0] - 2026-04-19

First public release. Core pillars in place: dynamic baseline diff, file history panel, per-file baselines, `@blame` chat participant. _(The chat participant was renamed to `@historian` post-0.1.0 — see Unreleased.)_

### Added

**Dynamic baseline diff**

- `QuickDiffProvider` on a custom `git-time-traveller:` URI scheme; gutter decorations can be computed against any git ref, not just `HEAD`.
- Sectioned baseline picker: HEAD, clear, custom ref, auto-detected merge-base targets (`main` / `master` / `develop` / `trunk`, local first with `origin/<name>` fallback), branches, tags, remote branches, recent commits.
- Per-file baseline overrides that shadow the workspace-wide baseline; `BaselineStore` emits a tagged `BaselineChange` event so consumers can narrow refreshes.
- Status bar item annotates `baseline: <ref> (file)` when a per-file override is active on the current editor.
- Stepping commands walk ±1 commit along `git log --follow` for the active file.
- `Open Diff with Baseline` command opens a side-by-side diff editor using the effective baseline.

**File history panel**

- Tree view under the built-in Source Control container, auto-following the active editor.
- Row layout: subject, `<author> · <date>`, markdown tooltip (short SHA, email, ISO date, body).
- Icons for regular commits, merges, the current baseline (`target`), and a synthetic "● Working tree (uncommitted changes)" row when the file is dirty.
- Rename following via `git log --follow`, with a "renamed from `<path>`" annotation on the newer side of each transition.
- Primary click sets the per-file baseline. Context menu covers: set as workspace baseline, open at revision, compare with working tree / previous revision, ask `@blame`, copy SHA / subject, **open on GitHub / GitLab / Bitbucket** (SSH and HTTPS remote forms, subgroup paths, user-info stripping).
- Title-bar button: **Ask `@blame` about this file** fires `@blame /story <path>` with one click.

**`@blame` chat participant**

- Four slash commands: `/why` (default, selection-focused), `/story` (full-file narrative), `/blame-since <ref>`, `/author <pattern>`.
- Grounded prompt: system prompt forbids invention; user prompt bundles the selection excerpt, a blame-by-SHA rollup with compressed line ranges, referenced commits, and the file log (capped).
- Commit-focused mode: when the prompt names a SHA, the handler ignores the editor's line selection. The prompt still carries a `File: <path>` scope line so the model knows what file to focus on.
- Smart timestamp: "09:05" for commits from today, "Apr 19, 2026" otherwise.
- Follow-up suggestions via `followupProvider` — cross-command and blame-aware.
- Commit references streamed via `stream.reference(makeTimeTravellerUri(…))` so every cited commit is a clickable chip.

**Engineering**

- 157 tests across 15 files, pure-helpers-first with `vscode` aliased to a hand-rolled mock.
- Smoke test activates the extension against the mock and asserts every declared command registers.
- CI (format → lint → typecheck → test → compile → `vsce package` smoke) and a tag-triggered release workflow that attaches the vsix to a GitHub Release.
