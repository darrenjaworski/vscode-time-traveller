# Git Time Traveller

Ask **`@historian`** _why_ a line is the way it is — grounded in real commit history, not guesswork. Then set any commit as your diff baseline and watch the gutter update live.

git-blame meets narrative history, in one VS Code extension.

---

## `@historian` — ask why

Open the chat panel, mention `@historian`, and ask in plain English. The participant shells out for `git blame` and `git log`, assembles structured evidence, and streams a grounded explanation — every cited commit becomes a clickable chip in the response.

```
@historian why is this written this way?
@historian /story
@historian /since main
@historian /author alice
```

**Slash commands:**

| Command             | What it does                                                  |
| ------------------- | ------------------------------------------------------------- |
| _(none / `/why`)_   | Explain the selected lines using blame attribution + file log |
| `/story`            | Chronological narrative of how the whole file got here        |
| `/since <ref>`      | Focus on everything that landed in this file since `<ref>`    |
| `/author <pattern>` | Filter to one author's commits on the file                    |

**From the File History panel** — every commit row has an inline "Ask `@historian`" action that pre-focuses the question on that specific commit, bypassing whatever lines happen to be selected. The panel title bar has a one-click **Ask `@historian` about this file** button for a full `/story` without typing.

Each commit in the evidence is tagged `<shortSha> · <author> · <time-or-date>` — "09:05" if today, "Apr 19, 2026" otherwise — so the model can gauge recency at a glance.

> **Requires a language-model provider** (e.g. GitHub Copilot Chat). Without one the participant falls back gracefully rather than erroring.

---

## Features

### Dynamic baseline diff

The gutter's modify/add/delete decorations normally show changes since `HEAD`. Swap that baseline to **any** git ref with one pick:

- current HEAD, or any branch, tag, or remote branch
- the last 30 commits on the current branch
- `merge-base HEAD main` (and `master` / `develop` / `trunk`, auto-detected local-first, falling back to `origin/<name>`) — the PR-review workflow
- a SHA or `stash@{N}` typed by hand

Two scopes: a workspace-wide baseline, and **per-file overrides** that shadow it. The status-bar item reflects the effective baseline and annotates `(file)` when an override is active.

### File history panel

A sidebar tree under the built-in **Source Control** view, backed by `git log --follow`. For the active file:

- subject, `<author> · <date>`, rich markdown tooltip (short SHA, email, ISO date, full body)
- icons distinguish regular commits, merges, the current baseline, and a synthetic "● Working tree" row when the file is dirty
- rename-following: every rename transition is annotated with "renamed from `<old path>`"
- **primary click** sets the commit as the per-file baseline — the gutter updates without reloading
- inline icons: compare with working tree, compare with previous revision, ask `@historian` about this commit
- context menu: set as baseline (per-file), set as workspace baseline, open at revision, copy SHA / subject, **open on GitHub / GitLab / Bitbucket**

### Stepping & diff

- **`Step Baseline Backward / Forward`** — walk ±1 commit along the file's log (writes to the per-file slot)
- **`Open Diff with Baseline`** — side-by-side editor using the effective baseline as the left side

---

## Getting started

1. **Install** — from the Marketplace, or `code --install-extension vscode-time-traveller-*.vsix`.
2. **Ask `@historian`** — open the chat panel and type `@historian /story` on any tracked file for an instant narrative.
3. **Pick a baseline** — `Time Traveller: Pick Diff Baseline…` from the Command Palette. The gutter updates immediately.
4. **Browse history** — click the Source Control icon in the Activity Bar; the **File History** panel appears below the git views.

Requires VS Code `^1.95.0` for the stable chat participant + `vscode.lm` APIs.

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

- `@historian` builds its prompt from structured evidence (selection + blame-per-line + referenced commits + file log) assembled by pure helpers in `src/historian/`. The orchestrator streams the model response and emits `stream.reference(uri)` per cited commit.
- Quick diff is driven by a `QuickDiffProvider` registered against a custom `git-time-traveller:` URI scheme. Live-baseline URIs carry no query and resolve the ref against the baseline store at read time, so decorations refresh the moment the baseline changes.
- File history shells `git log --follow --pretty=<custom>` and parses renames via a pure helper.

Prefer the built-in Git extension API for repo and ref enumeration; fall back to `git` CLI where the API doesn't expose what we need (blame, merge-base, stash list).

---

## Development

```bash
npm install
npm run watch       # incremental compile
# F5 in VS Code — launches the Extension Host with this extension loaded
npm run kitchen-sink  # format:check → lint → typecheck → test → compile → package
```

Tests use Vitest; the `vscode` module is aliased to a hand-rolled mock so pure logic is covered without booting VS Code.

Architecture, conventions, and testing guidance live in [`CLAUDE.md`](./CLAUDE.md). Phasing and in-flight work live in [`ROADMAP.md`](./ROADMAP.md).

---

## License

[MIT](./LICENSE)
