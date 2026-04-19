# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A VS Code extension that pairs a customizable `QuickDiffProvider` (pick any git ref — commit, branch, tag, or stash — as the gutter baseline) with an `@blame` chat participant that narrates _why_ lines changed using `vscode.lm`. `ROADMAP.md` is the source of truth for scope and phasing; treat it as the plan and update it when scope shifts.

## Commands

- `npm run compile` / `npm run watch` — TypeScript build to `out/`
- `npm run typecheck` — `tsc --noEmit`, fast signal without emitting
- `npm run lint` / `npm run lint:fix` — ESLint 9 flat config (`eslint.config.mjs`)
- `npm run format` / `npm run format:check` — Prettier (tabs, single quotes, 100 cols; JSON/YAML/MD overridden to 2-space)
- `npm test` / `npm run test:watch` — Vitest (runs with `--passWithNoTests` until tests exist)
- `npm run package` — `vsce package`, produces `vscode-time-traveller-<version>.vsix`
- `npm run kitchen-sink` — format:check → lint → typecheck → test → compile → package. Run this before tagging; CI (`ci.yml`) runs every step except `package`, and the release workflow (`release.yml`) runs the full kitchen-sink
- `F5` in VS Code — launches the Extension Host (uses `.vscode/launch.json` + `npm: compile` preLaunchTask)

## CI & release

- `.github/workflows/ci.yml` runs format:check, lint, typecheck, test, compile on every push and PR.
- `.github/workflows/release.yml` triggers on `v*` tags. It (1) asserts the tag matches `package.json` `version`, (2) runs `kitchen-sink`, (3) extracts the `## [x.y.z]` section from `CHANGELOG.md` as release notes, (4) creates a GitHub Release and attaches the `.vsix`. Tags with a hyphen (e.g. `v0.1.0-rc.1`) are marked prerelease.
- To cut a release: bump `version` in `package.json`, add a matching `## [x.y.z]` heading to `CHANGELOG.md`, commit, then `git tag vX.Y.Z && git push --tags`.

## Architecture

The extension has four cooperating pieces, all wired in `src/extension.ts` at activation:

1. **`BaselineStore` (`src/baseline.ts`)** — single source of truth for the user-selected git ref. Persists in `workspaceState` under `timeTraveller.baselineRef` and emits `onDidChange`. Everything that cares about the baseline subscribes here; do not read `workspaceState` directly.

2. **`TimeTravellerQuickDiff` (`src/quickDiff.ts`)** — intentionally implements **both** `QuickDiffProvider` _and_ `TextDocumentContentProvider` on the same class, bound to the custom `git-time-traveller:` URI scheme. The flow:
   - `provideOriginalResource(fileUri)` returns a URI like `git-time-traveller:/abs/path?ref=<encoded>` — the ref is carried in the query string, not class state, so different files/editors can coexist.
   - `provideTextDocumentContent(uri)` parses the ref out of the query, resolves the workspace folder, and returns the file contents at that ref.
   - When the baseline changes, it fires `onDidChange` for every open `git-time-traveller:` doc so gutter decorations refresh.

3. **`@blame` chat participant (`src/chat.ts`)** — registered via `vscode.chat.createChatParticipant('timeTraveller.blame', …)`. The id **must** match `contributes.chatParticipants[].id` in `package.json`. Currently selects `{ vendor: 'copilot', family: 'gpt-4o' }` via `vscode.lm.selectChatModels`; if no model is available it degrades gracefully with a message rather than throwing.

4. **`src/git.ts`** — thin wrapper that shells out to `git show <ref>:<relpath>`. **This is a stub.** Per Phase 1 of the roadmap, this should migrate to the built-in Git extension API (`vscode.extensions.getExtension('vscode.git').exports`) so ref enumeration, auth, and multi-root repos work correctly. Keep `git.ts` as the single choke point for that swap.

## Contribution points (package.json)

- `commands`: `timeTraveller.pickBaseline`, `clearBaseline`, `showCurrentBaseline`
- `chatParticipants`: `timeTraveller.blame` with `/why` and `/story` slash commands (handler does not yet branch on `request.command` — add that when implementing them)
- `configuration`: `timeTraveller.defaultBaseline` (not yet consumed by code)
- `engines.vscode`: `^1.95.0` — required for the stable chat participant + `vscode.lm` APIs. Do not lower this.

## Conventions

- The custom URI scheme is `TIME_TRAVELLER_SCHEME` exported from `quickDiff.ts`. Import the constant rather than hardcoding the string.
- Subscriptions: every `Disposable` created in `activate` is pushed onto `context.subscriptions`. Keep that pattern — leaking providers across Extension Host reloads causes duplicate gutter decorations.
- The status bar item's command is `timeTraveller.pickBaseline`; clicking the baseline label is the primary affordance for changing it. If you add a new ref-picker entry point, route it through the same command so UX stays consistent.
