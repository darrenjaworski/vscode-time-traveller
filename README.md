# Git Time Traveller

Pick any commit, branch, tag, or merge-base as the gutter diff baseline — and ask **`@blame`** _why_ a line changed, grounded in real git history.

git-blame meets narrative history, in one VS Code extension.

---

## Features

### Dynamic baseline diff

The gutter's modify/add/delete decorations normally show changes since `HEAD`. This extension lets you swap that baseline to **any** git ref with one pick:

- current HEAD, or any branch, tag, or remote branch
- the last 30 commits on the current branch
- `merge-base HEAD main` (and `master` / `develop` / `trunk`, auto-detected local-first, falling back to `origin/<name>`) — the PR-review workflow
- a SHA or `stash@{N}` typed by hand

Two scopes: a workspace-wide baseline, and **per-file overrides** that shadow it. The status-bar item reflects the effective baseline and annotates `(file)` when an override is in effect on the active editor.

### File history panel

A sidebar tree under the built-in **Source Control** view, backed by `git log --follow`. For the active file:

- subject, `<author> · <date>`, rich markdown tooltip (short SHA, email, ISO date, full body)
- icons distinguish regular commits, merges, the current baseline, and a synthetic "● Working tree (uncommitted changes)" row when the file is dirty
- rename-following: every rename transition is annotated with "renamed from `<old path>`"
- **primary click** sets the commit as the per-file baseline — the gutter updates without reloading
- inline icons: compare with working tree, compare with previous revision, ask `@blame` about this commit
- context menu: set as baseline (per-file), set as workspace baseline, open at revision, copy SHA / subject, **open on GitHub / GitLab / Bitbucket**
- title-bar button: **Ask `@blame` about this file** — one-click narrative timeline

### `@blame` — the narrator

The Time Traveller: a chat participant that explains _why_ lines got the way they are, grounded in real commit history rather than the model's imagination. Powered by `vscode.lm`. Four slash commands:

- **`/why`** _(default)_ — explains the selected lines using `git blame -w` for attribution and the file log for context
- **`/story`** — chronological narrative of how the file got to its current shape
- **`/blame-since <ref>`** — focus on everything that landed in this file since `<ref>`
- **`/author <pattern>`** — filter to one author's work on the file

Every cited commit becomes a clickable chip in the response. When you ask about a specific commit (e.g. from the history panel's "Ask `@blame` about this commit" action), the handler treats the question as commit-focused and ignores whatever lines happen to be selected.

Each commit in the prompt is tagged `<shortSha> · <author> · <time-or-date>` — "09:05" if today, "Apr 19, 2026" otherwise — so the model can tell at a glance how recent each event is.

### Multi-baseline scoping

- **`Step Baseline Backward / Forward`** — walk ±1 commit along the file's log (writes to the per-file slot)
- **`Open Diff with Baseline`** — side-by-side editor using the effective baseline as the left side

---

## Getting started

1. **Install** — from the Marketplace, or `code --install-extension vscode-time-traveller-*.vsix`.
2. **Pick a baseline** — `Time Traveller: Pick Diff Baseline…` from the Command Palette. The gutter updates immediately.
3. **Browse history** — click the Source Control icon in the Activity Bar; the **File History** panel appears below the git views. Open any tracked file to populate it.
4. **Ask `@blame`** — `@blame /story` in the chat for a file narrative, or select some lines and just `@blame why are these written this way?`.

Requires VS Code `^1.95.0` for the stable chat participant + `vscode.lm` APIs.

The `@blame` participant needs a language-model provider installed (e.g. GitHub Copilot Chat). Without one, it falls back to a helpful message rather than erroring.

---

## Commands

| Command                                             | What it does                                                                           |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `Time Traveller: Pick Diff Baseline…`               | Sectioned picker: presets, merge-base, branches, tags, remote branches, recent commits |
| `Time Traveller: Clear Diff Baseline`               | Fall back to HEAD workspace-wide                                                       |
| `Time Traveller: Pick Diff Baseline for This File…` | Same picker, file-scoped                                                               |
| `Time Traveller: Clear Per-File Baseline`           | Remove the override; global baseline takes effect again                                |
| `Time Traveller: Step Baseline Backward / Forward`  | ±1 commit along `git log --follow`                                                     |
| `Time Traveller: Open Diff with Baseline`           | Side-by-side diff editor                                                               |
| `Time Traveller: Show Current Baseline`             | Info message with the effective ref                                                    |

History-panel actions (row + title) aren't listed in the palette — they're only meaningful from the tree.

---

## Configuration

| Setting                         | Default | Description                                                                                                    |
| ------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| `timeTraveller.defaultBaseline` | `HEAD`  | Default git ref to diff against when no baseline is picked. _(Not yet consumed — reserved for a future pass.)_ |

---

## How it works

- Quick diff is driven by a `QuickDiffProvider` registered against a custom `git-time-traveller:` URI scheme. Live-baseline URIs carry no query and resolve the ref against the baseline store at read time, so decorations refresh the moment the baseline changes.
- File history shells `git log --follow --pretty=<custom>` and `git log --follow --name-only` (for rename annotations), parsed via a pure helper.
- `@blame` builds its prompt from structured evidence (selection + blame-per-line + referenced commits + file log) assembled by pure helpers in `src/blame/`. The orchestrator streams the model's response and emits `stream.reference(uri)` per cited commit.

Prefer the built-in Git extension API (`vscode.extensions.getExtension('vscode.git')`) for repo and ref enumeration; fall back to `git` CLI where the API doesn't expose what we need (blame, merge-base, stash list).

---

## Development

```bash
npm install
npm run watch       # incremental compile
# F5 in VS Code — launches the Extension Host with this extension loaded
npm run kitchen-sink  # format:check → lint → typecheck → test → compile → package
```

Tests use Vitest; the `vscode` module is aliased to a hand-rolled mock (`test/mocks/vscode.ts`) so pure logic is covered without booting VS Code. A smoke test activates the extension against the mock and asserts every declared command gets registered.

Architecture, conventions, and testing guidance live in [`CLAUDE.md`](./CLAUDE.md). Phasing and in-flight work live in [`ROADMAP.md`](./ROADMAP.md).

---

## License

[MIT](./LICENSE)
