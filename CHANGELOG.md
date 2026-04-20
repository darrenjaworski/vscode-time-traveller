# Changelog

All notable changes to this extension are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the release workflow extracts the section matching the tag version (e.g. `v0.1.0` → `## [0.1.0]`).

## [Unreleased]

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
