# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A VS Code extension that pairs a customizable `QuickDiffProvider` (pick any git ref — commit, branch, tag, or stash — as the gutter baseline) with an `@blame` chat participant that narrates _why_ lines changed using `vscode.lm`, plus a File History panel. `ROADMAP.md` is the source of truth for scope and phasing; treat it as the plan and update it when scope shifts.

## Commands

- `npm run compile` / `npm run watch` — TypeScript build to `out/`
- `npm run typecheck` — runs `tsc --noEmit` against both the src config and `tsconfig.test.json` (so tests type-check too)
- `npm run lint` / `npm run lint:fix` — ESLint 9 flat config (`eslint.config.mjs`)
- `npm run format` / `npm run format:check` — Prettier (tabs, single quotes, 100 cols; JSON/YAML/MD overridden to 2-space)
- `npm test` / `npm run test:watch` — Vitest; finds `src/**/*.test.ts` (including `*.smoke.test.ts`)
- `npm run package` — `vsce package`, produces `vscode-time-traveller-<version>.vsix`
- `npm run kitchen-sink` — format:check → lint → typecheck → test → compile → package. Run this before tagging; CI (`ci.yml`) runs every step except `package`, and the release workflow (`release.yml`) runs the full kitchen-sink
- `F5` in VS Code — launches the Extension Host (uses `.vscode/launch.json` + `npm: compile` preLaunchTask)

## CI & release

- `.github/workflows/ci.yml` runs format:check, lint, typecheck, test, compile on every push and PR.
- `.github/workflows/release.yml` triggers on `v*` tags. It (1) asserts the tag matches `package.json` `version`, (2) runs `kitchen-sink`, (3) extracts the `## [x.y.z]` section from `CHANGELOG.md` as release notes, (4) creates a GitHub Release and attaches the `.vsix`. Tags with a hyphen (e.g. `v0.1.0-rc.1`) are marked prerelease.
- To cut a release: bump `version` in `package.json`, add a matching `## [x.y.z]` heading to `CHANGELOG.md`, commit, then `git tag vX.Y.Z && git push --tags`.

## Architecture

Everything is wired in `src/extension.ts` at activation. Each cooperating piece has a single responsibility and its own module so tests and refactors stay local:

1. **`BaselineStore` (`src/baseline.ts`)** — single source of truth for the user-selected git ref. Two scopes: **global** (workspace-wide, memento key `timeTraveller.baselineRef`) and **per-file** (URI-keyed map under `timeTraveller.baselineRefsByFile`). `get(uri)` returns the per-file override if present, else global, else undefined. `set(ref)` updates the global slot; `setForFile(uri, ref)` updates the per-file slot; `clearForFile(uri)` removes an override without touching global. Emits a tagged `BaselineChange` (`{ scope: 'global' | 'file', uri?, ref }`) so consumers can target their refreshes. Everything that cares about the baseline subscribes here; do not read `workspaceState` directly.

2. **`TimeTravellerQuickDiff` (`src/quickDiff.ts`)** — implements **both** `QuickDiffProvider` _and_ `TextDocumentContentProvider` on the same class, bound to the custom `git-time-traveller:` URI scheme. **Two URI shapes:**
   - **Live-baseline URI** (no query) — returned by `provideOriginalResource`. Its content is resolved against `BaselineStore` at read time via the pure `resolveRefForUri` helper. When the store fires `onDidChange`, we refire for the matching URI and VS Code re-reads fresh content. This is what drives gutter decorations.
   - **Explicit-ref URI** (`?ref=<sha>`) — built by `makeTimeTravellerUri(repoRoot, relPath, ref)`. The ref is pinned in the query and immune to baseline changes. Used by the history panel for "Open at revision" and diff-at-commit flows.
     The `onDidChange` listener filters out explicit-ref URIs and narrows global-scope changes to all live URIs, file-scope changes to just the matching URI path.

3. **Baseline QuickPick (`src/baselinePicker.ts`)** — assembles a sectioned `QuickPick` (Presets · Scopes · Branches · Tags · Remote branches · Recent commits) from the built-in Git extension API (see `src/git/api.ts`) plus a `logRecent` CLI fallback. The Scopes section surfaces "Merge base with `<default-branch>`" rows via `detectMergeBaseCandidates`; on pick, `getMergeBase` computes the fork-point SHA. Returns a tagged union (`{ kind: 'ref' | 'clear' | 'cancel' }`) so the caller never has to disambiguate undefined. The item builders are pure and tested in isolation.

4. **File history panel (`src/history/*`)** — a `TreeDataProvider` backed by `git log --follow`, surfaced in the Time Traveller activity bar container. `service.ts` exposes `getFileHistory(uri)` with pure `toHistoryEntry` + `applyRenames` transforms; `provider.ts` renders each commit via pure helpers (`iconIdFor`, `descriptionFor`, `buildTooltipMarkdown`) and uses `baseline.get(currentFileUri)` for the "is this the baseline" marker so per-file overrides light up the right row; `view.ts` wires the tree view, active-editor listener, and commands. Node kinds: `entry`, `placeholder`, `workingTree` (synthetic top row when `git diff --quiet HEAD -- <file>` is non-zero; clicking it clears the per-file baseline). **Primary click on an entry sets the commit as the _per-file_ baseline** (the panel is file-scoped); the context menu has "Set as workspace baseline" as an escape hatch and "Open on remote" for GitHub/GitLab/Bitbucket via `src/remote.ts`'s pure URL parser.

5. **Multi-baseline commands (`src/multiBaseline.ts`)** — `stepBaseline(direction)` moves the active file's per-file baseline ±1 commit along its `git log --follow`, backed by the pure `computeStep` in `src/stepping.ts`. `openDiffWithBaseline()` opens a side-by-side diff editor using the effective baseline as the left side. Both write to `BaselineStore.setForFile` (stepping is always file-scoped).

6. **`@blame` chat participant (`src/chat.ts` + `src/blame/*`)** — registered via `vscode.chat.createChatParticipant('timeTraveller.blame', …)`. The id **must** match `contributes.chatParticipants[].id` in `package.json`. Slash commands: `/why` (default, selection-focused), `/story` (full-file narrative), `/blame-since <ref>`, `/author <pattern>`. Orchestrator in `chat.ts` parses the command, shells out for blame/log via `src/git/cli.ts`, hands the raw records to the **pure** helpers in `src/blame/*` (`composeEvidence`, `buildUserPrompt`, `suggestFollowups`), selects `{ vendor: 'copilot', family: 'gpt-4o' }` via `vscode.lm.selectChatModels`, streams the response, emits `stream.reference(makeTimeTravellerUri(…))` for each cited commit, and returns `metadata.command` + `metadata.evidence` so `followupProvider.provideFollowups` can synthesize drill-downs. Degrades gracefully when no model is available.

7. **Git layer (`src/git/`)** — `api.ts` wraps the built-in Git extension (`vscode.extensions.getExtension('vscode.git')`); `cli.ts` is a thin shell-out fallback (`git show`, `git log`, `git merge-base`) with pure parsing helpers (`parseLog`, `shellQuote`) exported for tests. Prefer the API where it suffices; keep `cli.ts` as the single choke point for shell-based git work.

## Testing

The test strategy is "pure logic first, mocked boundaries second". Follow this so future refactors stay cheap:

- **Pure helpers, no `vscode` import.** Relative time, log parsing, tooltip markdown, ref-icon selection, status-bar ref formatting, picker item builders — all live as top-level exported functions with zero `vscode` dependency. Tests import and call them directly. When you add behavior, ask "can the logic live outside the module that touches `vscode`?" first; usually yes.
- **`vscode` is aliased to `test/mocks/vscode.ts` in `vitest.config.ts`.** The mock covers only the surface the extension actually uses, with realistic behavior where it matters (`EventEmitter` actually dispatches, `Uri` is backed by `vscode-uri`). When a new source module reaches for a `vscode` export that isn't stubbed yet, extend the mock — don't weaken the test.
- **Fakes over mocks for stateful collaborators.** `test/fakes/memento.ts` is a real `Memento` implementation so `BaselineStore` tests exercise the same code path as production. Prefer fakes when the interface is small and stateful; save `vi.fn()` for one-off call-capture assertions.
- **Smoke test lives at `src/extension.smoke.test.ts`.** It activates the extension against the mock, asserts every command declared in `package.json` gets registered, and confirms the status bar / SCM source control / tree view / chat participant are all created. Update it (not delete it) when you add or rename contribution points — a failing smoke test is usually a real wiring regression.
- **Two tsconfigs.** `tsconfig.json` is for the emitted extension build (excludes `*.test.ts`). `tsconfig.test.json` extends it and includes `test/` + tests so `npm run typecheck` covers both.

### Adding a new module

When you add a module under `src/`:

1. Extract the parts that don't need `vscode` into pure, exported functions.
2. Co-locate `foo.ts` and `foo.test.ts`. Vitest picks `*.test.ts` up automatically.
3. If the module contributes a new command, view, or participant, add an assertion to `src/extension.smoke.test.ts`.
4. If you need a new `vscode` surface in tests, extend `test/mocks/vscode.ts` rather than case-mocking per test.

## Contribution points (package.json)

- `commands`:
  - **Global baseline**: `timeTraveller.pickBaseline`, `clearBaseline`, `showCurrentBaseline`
  - **Per-file baseline**: `timeTraveller.pickBaselineForFile`, `clearBaselineForFile`
  - **Stepping**: `timeTraveller.stepBaselineBackward` (older), `stepBaselineForward` (newer)
  - **Diff**: `timeTraveller.openDiffWithBaseline` (side-by-side editor)
  - **History panel**: `timeTraveller.history.*` family (refresh, setBaseline, setAsGlobalBaseline, openAtRevision, openDiff, askBlame, copySha, copySubject). Hidden from the Command Palette via `menus.commandPalette[].when: 'false'` — they only make sense when invoked from a tree row.
- `viewsContainers.activitybar`: `timeTraveller` (icon: `resources/history.svg`)
- `views["timeTraveller"]`: `timeTraveller.fileHistory`
- `chatParticipants`: `timeTraveller.blame` with `/why` and `/story` slash commands (handler does not yet branch on `request.command` — add that when implementing them).
- `configuration`: `timeTraveller.defaultBaseline` (not yet consumed by code).
- `engines.vscode`: `^1.95.0` — required for the stable chat participant + `vscode.lm` APIs. Do not lower this.

## Conventions

- The custom URI scheme is `TIME_TRAVELLER_SCHEME` exported from `quickDiff.ts`. Import the constant rather than hardcoding the string. When you need a URI for a specific commit, call `makeTimeTravellerUri(repoRoot, relPath, ref)` — don't rebuild it by hand.
- Subscriptions: every `Disposable` created in `activate` is pushed onto `context.subscriptions`. Keep that pattern — leaking providers across Extension Host reloads causes duplicate gutter decorations.
- The status bar item's command is `timeTraveller.pickBaseline`; clicking the baseline label is the primary affordance for changing it. If you add a new ref-picker entry point, route it through the same command so UX stays consistent.
- Prefer the built-in Git extension API (`src/git/api.ts`) over shelling out. Reach for `src/git/cli.ts` only for the fields/commands the API doesn't expose (e.g. stash enumeration, `git log --follow` with a custom `--pretty` format).
