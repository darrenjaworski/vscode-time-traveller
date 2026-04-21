# Contributing

Thanks for poking at Git Time Traveller. This doc covers the dev loop and the manual smoke test you should run before tagging a release.

## Dev loop

- Install: `npm install`
- Launch the Extension Host: press `F5` in VS Code (runs `npm: compile` as the preLaunchTask, opens a second window with the extension active)
- Watch build: `npm run watch`
- Fast feedback: `npm run test:watch`
- Before tagging a release: `npm run kitchen-sink` (format:check → lint → typecheck → test → compile → package)

See `CLAUDE.md` for architecture, module boundaries, and the testing philosophy.

## Manual test checklist

Unit tests cover pure logic, but a lot of this extension lives at the `vscode` boundary (QuickPick UX, TreeView rendering, chat streaming, CodeLens positioning). Run through this list in the Extension Host before cutting a release. Use a repo with real history — this repo itself works fine.

### Baseline picker

- [ ] Status bar shows `$(history) HEAD` (or the active ref) in the bottom-left
- [ ] Clicking the status bar item opens the QuickPick
- [ ] QuickPick sections appear in order: Presets · Scopes · Branches · Tags · Remote branches · Stashes · Recent commits
- [ ] "Merge base with `<default-branch>`" shows up under Scopes when a default branch exists and isn't the current branch
- [ ] "Last release (vX.Y.Z)" shows up under Scopes when the repo has semver tags
- [ ] Stashes section appears only when `git stash list` returns entries (try `git stash push` then re-open the picker)
- [ ] Picking a branch/tag/commit/stash updates gutter diffs in the active editor without reloading the document
- [ ] "Enter a git ref…" accepts a typed SHA and applies it
- [ ] "Clear baseline" falls back to HEAD; status bar drops the ref suffix

### Per-file baseline

- [ ] Run "Pick Diff Baseline for This File…" — status bar appends `(file)` when an override is active
- [ ] Open a different file — status bar reverts to the workspace baseline
- [ ] "Clear Per-File Baseline" removes the override without touching the workspace baseline
- [ ] Step Backward / Forward commands shift the active file's baseline one commit along its `git log --follow`; stops gracefully at the ends

### File history panel

- [ ] Panel lives under the Source Control view container (no dedicated Activity Bar icon)
- [ ] Opening a tracked file populates the panel; switching editors updates it
- [ ] Untracked file / no-repo / file outside workspace → friendly empty state, no errors in the Output panel
- [ ] When the active file has uncommitted changes, a synthetic "● Working tree" row appears at the top
- [ ] Clicking the Working tree row clears the per-file baseline
- [ ] Clicking a commit row sets it as the per-file baseline; the baseline row is visually marked
- [ ] Row description shows `<author> · <relative date>`; tooltip shows short SHA, full body, absolute ISO date
- [ ] Icons differ between normal commit, merge commit, and the currently-selected baseline
- [ ] Rename transitions show a "renamed from …" affordance on the first post-rename entry
- [ ] Inline actions: "Compare with working tree", "Compare with previous revision"
- [ ] Context menu: Set as baseline · Set as workspace baseline · Open file at this revision · Ask @historian about this commit · Tell the story of this commit · Copy SHA · Copy subject · Open on remote (GitHub/GitLab/Bitbucket repos only)
- [ ] "Tell the story of this commit" prefills the chat with `@historian /story <sha>` and the response is commit-focused (motivation + files touched + surrounding history), not a file-wide timeline
- [ ] "Open on remote" builds a correct URL for GitHub, GitLab, and Bitbucket remotes
- [ ] Refresh action at the top of the view re-runs `git log` (busts the in-memory cache)
- [ ] "Load more…" row appears at the bottom when more commits exist; clicking it extends the list by 50

### File history filters & grouping

- [ ] "Filter by subject/body…" action opens an input box; non-empty text filters commits case-insensitively against subject + body
- [ ] Active filters are shown in the view description (e.g. `"fix login" · no merges · by author`)
- [ ] "Toggle hide merge commits" removes/restores merge rows
- [ ] "Group history by…" offers None / By date / By author; date buckets are Today / Yesterday / This week / This month / This year / Older
- [ ] "Clear filters" only appears when at least one filter is active; clicking it resets text, merge toggle, and grouping
- [ ] Filter + grouping state persists across reloading the window (workspaceState)
- [ ] When every entry is filtered out, a "No commits match the current filters." placeholder renders and "Load more…" is still offered

### Diff editor

- [ ] "Open Diff with Baseline" opens a side-by-side editor with the effective baseline on the left
- [ ] Editing in the right pane does not mutate the baseline content

### `@historian` chat participant

- [ ] Typing `@historian` in the chat picker shows the participant
- [ ] `/why` with a selection returns a narrative grounded in blame + commit bodies
- [ ] `/why` with no selection (cursor only) does not fabricate a line range
- [ ] `/story` returns a file-level narrative
- [ ] `/since <ref>` scopes the evidence to commits after that ref
- [ ] `/author <pattern>` filters to matching authors
- [ ] Cited commits render as clickable references (opens the `git-time-traveller:?ref=<sha>` URI)
- [ ] Follow-up suggestions appear after a response and are relevant to the command that produced it
- [ ] No language model available → graceful error message, no unhandled rejection

### CodeLens

- [ ] "Ask @historian why this changed" lens appears above each changed hunk when diff vs baseline is non-empty
- [ ] Clicking the lens selects the hunk lines and opens the chat with a seed prompt
- [ ] Setting `timeTraveller.codeLens.enabled` to `false` hides all lenses

### Edge cases

- [ ] Multi-root workspace: baseline picker and history panel both resolve against the active editor's folder
- [ ] Detached HEAD: status bar still renders, picker still works
- [ ] Shallow clone: history panel shows what's available without errors
- [ ] Binary file in the history panel: rows render; diff actions degrade gracefully (or are hidden)
- [ ] Extension Host reload (Cmd+R in the dev window): no duplicate gutter decorations, no duplicate status bar items

## Releasing

1. Bump `version` in `package.json`
2. Add a matching `## [x.y.z]` section to `CHANGELOG.md`
3. Commit, then `git tag vX.Y.Z && git push --tags`
4. The `release.yml` workflow handles the rest (kitchen-sink, GitHub Release with the `.vsix` attached, prerelease flag for tags with a hyphen)
