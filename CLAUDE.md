# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A VS Code extension that pairs a customizable `QuickDiffProvider` (pick any git ref — commit, branch, tag, or stash — as the gutter baseline) with an `@historian` chat participant that narrates _why_ lines changed using `vscode.lm`, plus a File History panel and a multi-provider PR/MR context layer (GitHub, GitLab, Bitbucket, GitHub Enterprise). `ROADMAP.md` is the source of truth for scope and phasing; treat it as the plan and update it when scope shifts.

## Commands

- `npm run compile` / `npm run watch` — TypeScript build to `out/`
- `npm run typecheck` — runs `tsc --noEmit` against both the src config and `tsconfig.test.json` (so tests type-check too)
- `npm run lint` / `npm run lint:fix` — ESLint 9 flat config (`eslint.config.mjs`)
- `npm run format` / `npm run format:check` — Prettier (tabs, single quotes, 100 cols; JSON/YAML/MD overridden to 2-space)
- `npm test` / `npm run test:watch` — Vitest; finds `src/**/*.test.ts` (including `*.smoke.test.ts`)
- `npm run package` — `vsce package`, produces `vscode-time-traveller-<version>.vsix`
- `npm run kitchen-sink` — format:check → lint → typecheck → test → compile → package. **Run this before every commit that touches more than docs.** CI runs every step except `package`; the release workflow runs the full kitchen-sink.
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

4. **File history panel (`src/history/*`)** — a `TreeDataProvider` backed by `git log --follow`, surfaced under the built-in **Source Control** sidebar. `service.ts` exposes `getFileHistory(uri)` with pure `toHistoryEntry` + `applyRenames` transforms; `provider.ts` renders each commit via pure helpers (`iconIdFor`, `descriptionFor`, `buildTooltipMarkdown`) and uses `baseline.get(currentFileUri)` for the "is this the baseline" marker so per-file overrides light up the right row; `view.ts` wires the tree view, active-editor listener, and commands. Node kinds: `entry`, `placeholder`, `workingTree` (synthetic top row when `git diff --quiet HEAD -- <file>` is non-zero; clicking it clears the per-file baseline). **Primary click on an entry sets the commit as the _per-file_ baseline** (the panel is file-scoped); the context menu has "Set as workspace baseline" as an escape hatch and "Open on remote" for GitHub/GitLab/Bitbucket via `src/remote.ts`'s pure URL parser. Pagination, filters, and grouping live in `filters.ts` (pure) and persist per-workspace under `timeTraveller.history.state`. An LRU cache keyed by `(repoRoot, relPath, limit)` is invalidated per-repo on `Repository.state.onDidChange`.

5. **Multi-baseline commands (`src/multiBaseline.ts`)** — `stepBaseline(direction)` moves the active file's per-file baseline ±1 commit along its `git log --follow`, backed by the pure `computeStep` in `src/stepping.ts`. `openDiffWithBaseline()` opens a side-by-side diff editor using the effective baseline as the left side. Both write to `BaselineStore.setForFile` (stepping is always file-scoped).

6. **`@historian` chat participant (`src/chat.ts` + `src/historian/*`)** — registered via `vscode.chat.createChatParticipant('timeTraveller.historian', …)`. The id **must** match `contributes.chatParticipants[].id` in `package.json`. Slash commands: `/why` (default, selection-focused), `/story` (full-file narrative), `/story <sha>` (commit-focused), `/since <ref>`, `/author <pattern>`. Model selection is driven by VS Code's chat model picker (gear icon) — the orchestrator calls `request.model` rather than hardcoding a vendor/family.

   The handler:
   - Parses the slash command via `normalizeCommand`, gathers evidence in `gatherEvidence` (blame + log + parent-diff snippets + per-commit numstat + multi-provider PR data + attached `#file` references), and threads prior `ChatResponseTurn`s back into the message stream for multi-turn awareness.
   - Decides between two paths based on `timeTraveller.chat.toolCalling`:
     - **Tool-calling path** (`runToolCallingLoop`, exported for tests): builds a slim prompt via `buildUserPrompt(..., { toolCalling: true })`, sends with `tools: timeTraveller_*` filtered from `vscode.lm.tools`, and loops up to `maxToolRounds` times invoking each `LanguageModelToolCallPart` via `vscode.lm.invokeTool` and feeding `LanguageModelToolResultPart` back into the message list. Falls back to the non-tool path on `Unsupported` errors.
     - **Non-tool path** (`runNonToolPath`): single-shot with the full pre-loaded prompt (legacy behavior, used when the model lacks tool-calling support or the user disabled it).
   - Streams the response and emits `stream.reference(makeTimeTravellerUri(…))` per cited commit, `stream.button(...)` for action buttons via `suggestActionButtons`, `stream.anchor(...)` for selection/blame locations via `suggestAnchors`, and `stream.filetree(...)` for `/story <sha>` files-changed. Returns `metadata.command + metadata.evidence` so `followupProvider.provideFollowups` can synthesize drill-downs.

   All prompt/evidence/button/anchor/follow-up logic lives in pure `src/historian/*` modules (`composeEvidence`, `buildUserPrompt`, `suggestFollowups`, `suggestActionButtons`, `suggestAnchors`, `trimPatch`). Degrades gracefully when no model is available.

7. **Language model tools (`src/tools/*`)** — six `vscode.LanguageModelTool` registrations the `@historian` model can invoke during the tool-calling loop: `timeTraveller_searchCommits`, `_getCommitDetails`, `_getCommitDiff`, `_getBlame`, `_findPRsForCommit`, `_listFileHistory`. Each tool is a class with an `invoke(options, token)` method returning `LanguageModelToolResult([new LanguageModelTextPart(...)])` and a `prepareInvocation` for the user-visible "Reading commit abc1234…" message. Tools are **dependency-injected** with their git-CLI helpers (e.g. `gitShow`, `showCommitPatch`, `blameRange`) so unit tests pass mocks; `register.ts` is the single place that wires real CLI calls. The `repoRoot` is captured in the closure at registration time — never read from tool input — so a prompt-injected tool call can't escape the active workspace. Declared in `package.json` under `contributes.languageModelTools`; `register.test.ts` locks in the real wiring against future stubbing regressions.

8. **Multi-provider PR/MR context (`src/pr/*`)** — `service.ts` orchestrates lookups via the `PRProvider` abstraction in `provider.ts` (`pickProvider(remote)` returns the first matching provider). Concrete providers: `github.ts`, `gheServer.ts` (Enterprise — same API, custom `baseUrl`), `gitlab.ts` (MR endpoint with state-string adapter), `bitbucket.ts` (PR endpoint with `values[]` envelope adapter, Basic auth via app password). Auth is per-provider: GitHub uses VS Code's silent session; GHE/GitLab/Bitbucket fall back to settings-stored tokens. `PRCache` (in `cache.ts`) is keyed by SHA only — multi-provider works because the same SHA never lives on two providers in one repo. Remote detection in `src/remote.ts` returns a `RemoteHost` union (`'github' | 'gitlab' | 'bitbucket' | 'github-enterprise' | 'unknown'`) with optional `baseUrl`; self-hosted hostnames are mapped via `timeTraveller.enterprise.hosts`. Each provider has its own test file plus shared service-level tests for routing.

9. **Chat variable resolvers (`src/chatVariables.ts`)** — registers `#timeTraveller.baseline`, `#timeTraveller.history`, `#timeTraveller.commit` so users can pull our state into any chat (Copilot, `@workspace`, etc.), not just `@historian`. Pure formatters per variable; declared in `package.json` under `contributes.chatVariables`.

10. **Git layer (`src/git/`)** — `api.ts` wraps the built-in Git extension (`vscode.extensions.getExtension('vscode.git')`); `cli.ts` is a thin shell-out fallback (`git show`, `git log`, `git merge-base`, `git blame --porcelain`, etc.) with pure parsing helpers (`parseLog`, `parseNumstat`, `parseBlamePorcelain`, `shellQuote`) exported for tests. **`cli.ts` is the single choke point for shell-based git work** — never spawn `git` directly from feature modules. Prefer the API where it suffices; reach for `cli.ts` for fields/commands the API doesn't expose (blame, merge-base, stash list, `--numstat`, `--patch`, `--grep`, `--since`, `--author`).

## Testing

The test strategy is **"pure logic first, mocked boundaries second"**. Follow this so future refactors stay cheap.

- **Pure helpers, no `vscode` import.** Relative time, log parsing, tooltip markdown, ref-icon selection, status-bar ref formatting, picker item builders, evidence composition, prompt building, button/anchor selection, PR adapters, blame range formatters — all live as top-level exported functions with zero `vscode` dependency. Tests import and call them directly. **When you add behavior, ask "can the logic live outside the module that touches `vscode`?" first.** Usually yes.
- **`vscode` is aliased to `test/mocks/vscode.ts` in `vitest.config.ts`.** The mock covers only the surface the extension actually uses, with realistic behavior where it matters (`EventEmitter` actually dispatches, `Uri` is backed by `vscode-uri`, language-model `*Part` classes are constructible). When a new source module reaches for a `vscode` export that isn't stubbed yet, **extend the mock — don't weaken the test or case-mock per file.**
- **Fakes over mocks for stateful collaborators.** `test/fakes/memento.ts` is a real `Memento` implementation so `BaselineStore` tests exercise the same code path as production. Prefer fakes when the interface is small and stateful; save `vi.fn()` for one-off call-capture assertions.
- **Dependency injection at module boundaries.** Every module that does I/O accepts its dependencies as a constructor/argument object (e.g. `GetCommitDetailsTool({ repoRoot, gitShow })`, `lookupPRs({ resolveRemote, providers })`). Production wiring happens in one place per area (`src/tools/register.ts`, `src/pr/service.ts`'s `DEFAULT_PROVIDERS`); tests pass fakes. **Never let a tool/provider/handler reach for a real network or shell call directly.**
- **Smoke test (`src/extension.smoke.test.ts`)** activates the extension against the mock, asserts every command declared in `package.json` is registered, and confirms the status bar / SCM source control / tree view / chat participant / chat variable resolvers / language model tools are all created. **Update it (don't delete it) when you add or rename a contribution point** — a failing smoke test is usually a real wiring regression.
- **Integration tests for orchestration logic.** `src/chat.toolLoop.test.ts` covers the tool-calling loop with a fake `LanguageModelChat`. When you write code that drives multiple tool calls, follow the same pattern: mock `sendRequest` to return a stream of `LanguageModel*Part` instances, assert side effects on the response stream and `invokeTool`.
- **Two tsconfigs.** `tsconfig.json` is for the emitted extension build (excludes `*.test.ts`). `tsconfig.test.json` extends it and includes `test/` + tests so `npm run typecheck` covers both.

### Adding a new module

When you add a module under `src/`:

1. **Extract the parts that don't need `vscode` into pure, exported functions.** This is non-negotiable — it's how every module in this repo stays testable.
2. **Co-locate `foo.ts` and `foo.test.ts`.** Vitest picks `*.test.ts` up automatically. Aim for at least one happy-path test and one edge case before merging.
3. **If the module contributes a new command, view, participant, tool, or chat variable, add an assertion to `src/extension.smoke.test.ts`.**
4. **If the module makes I/O calls (git CLI, network, file system), inject those as dependencies** — don't import them at module scope where they'd be impossible to mock cleanly.
5. **If you need a new `vscode` surface in tests, extend `test/mocks/vscode.ts`.** Don't case-mock per test file.
6. **Run `npm run kitchen-sink` before committing.** Format, lint, typecheck, test, compile, package — all green or you don't ship.

## Maintainability

These are non-negotiable rules learned from real bugs in this codebase:

- **No stubs in production code.** If a dependency function is "TODO: wire up later", the bug will ship and the LM will get empty data. The Tier C `getCommitDetails` regression (stub `gitShow` returning empty strings) is the canonical example. **Either the function is real or the registration is gated behind a feature flag** — never half-wired.
- **Lock in real wiring with tests.** When you wire a tool/provider/handler to real I/O, add a test that mocks the I/O module and asserts the wiring uses it. `src/tools/register.test.ts` is the template.
- **Single choke point per concern.** All git CLI calls go through `src/git/cli.ts`. All PR lookups go through `src/pr/service.ts`. All baseline reads go through `BaselineStore`. **Don't bypass these abstractions** — even for "just one quick call".
- **YAGNI ruthlessly.** Don't add error handling, fallbacks, or validation for cases that can't happen. Don't design for hypothetical multi-provider auth schemes when settings work fine. If a feature isn't in the current task, it doesn't get scaffolded.
- **No premature abstraction.** Three similar lines is better than a half-baked base class. The `PRProvider` interface earned its existence by having four real implementations; don't extract one before you have two.
- **No comments that restate the code.** Names already say _what_. Comments are for _why_ — a hidden constraint, an invariant, a workaround. The Tier C plan-commit comments ("Wire to src/git/cli.ts: gitShow ... Task 4") are the anti-pattern: they describe future work that should have been a real implementation, and they rotted into bugs.
- **Each PR-providing module is a single file with a single external call.** When the upstream API drifts, the fix is a unit-test-driven swap of one file. Don't sprawl provider logic across helpers.
- **Tool inputs do not include `repoRoot` or paths the model could redirect.** Closure-capture them at registration. A prompt-injected tool call that can rewrite `repoRoot` is a vulnerability.
- **`engines.vscode: ^1.95.0` is load-bearing.** Stable chat participant + `vscode.lm` APIs depend on it. Do not lower it.
- **CHANGELOG and CONTRIBUTING.md are part of the feature.** When you add a new provider/tool/setting, the manual test checklist in `CONTRIBUTING.md` and the `[Unreleased]` section in `CHANGELOG.md` get updated in the same PR. Documentation drift is a bug.

## Contribution points (package.json)

- **`commands`:**
  - **Global baseline**: `timeTraveller.pickBaseline`, `clearBaseline`, `showCurrentBaseline`
  - **Per-file baseline**: `timeTraveller.pickBaselineForFile`, `clearBaselineForFile`
  - **Stepping**: `timeTraveller.stepBaselineBackward` (older), `stepBaselineForward` (newer)
  - **Diff**: `timeTraveller.openDiffWithBaseline` (side-by-side editor)
  - **History panel**: `timeTraveller.history.*` family (refresh, setBaseline, setAsGlobalBaseline, openAtRevision, openDiff, askBlame, copySha, copySubject, openOnRemote, tellStory, filter, toggleHideMerges, groupBy, clearFilters). Hidden from the Command Palette via `menus.commandPalette[].when: 'false'` — they only make sense when invoked from a tree row.
- **`views.scm`**: `timeTraveller.fileHistory` — lives alongside git's views inside the built-in Source Control sidebar (no dedicated Activity Bar container; the empty "Time Traveller (baseline)" row there is the `SourceControl` we register solely to attach `quickDiffProvider`).
- **`chatParticipants`**: `timeTraveller.historian` (id) / `historian` (display name) with `/why`, `/story`, `/since`, `/author` slash commands; `commandPalette: false`. The handler branches on `request.command` via `normalizeCommand`.
- **`languageModelTools`**: six `timeTraveller_*` tools (see Architecture §7); each has an `inputSchema`, `displayName`, and `modelDescription` the LM uses to decide when to invoke.
- **`chatVariables`**: `timeTraveller.baseline`, `timeTraveller.history`, `timeTraveller.commit` (see Architecture §9).
- **`configuration`**: chat-and-evidence settings (`chat.maxBlameEvidenceTokens`, `chat.toolCalling`, `chat.maxToolRounds`), PR auth (`pr.enabled`, `gitlabToken`, `bitbucketAppPassword`, `gheToken`, `enterprise.hosts`), and diff/UI (`defaultBaseline`, `codeLens.enabled`, `hover.enabled`). All consumed; if you add a setting, read it somewhere in the same PR.
- **`engines.vscode`**: `^1.95.0` — required for the stable chat participant + `vscode.lm` APIs. Do not lower this.

## Conventions

- The custom URI scheme is `TIME_TRAVELLER_SCHEME` exported from `quickDiff.ts`. Import the constant rather than hardcoding the string. When you need a URI for a specific commit, call `makeTimeTravellerUri(repoRoot, relPath, ref)` — don't rebuild it by hand.
- Subscriptions: every `Disposable` created in `activate` is pushed onto `context.subscriptions`. Keep that pattern — leaking providers across Extension Host reloads causes duplicate gutter decorations.
- The status bar item's command is `timeTraveller.pickBaseline`; clicking the baseline label is the primary affordance for changing it. If you add a new ref-picker entry point, route it through the same command so UX stays consistent.
- Prefer the built-in Git extension API (`src/git/api.ts`) over shelling out. Reach for `src/git/cli.ts` only for the fields/commands the API doesn't expose (e.g. stash enumeration, `git log --follow` with a custom `--pretty` format, blame, numstat, patch, search-by-grep).
- Tool/provider/handler classes accept their dependencies; module-scope imports of `child_process`, `node:fs`, or `fetch` outside of `src/git/cli.ts` and `src/pr/<provider>.ts` are red flags.
