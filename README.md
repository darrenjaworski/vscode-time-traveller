# Git Time Traveller

Ask **`@historian`** _why_ a line is the way it is — grounded in real commit history, not guesswork. Set any commit as your diff baseline and watch the gutter update live. Explore the story of a file — or any single commit — without leaving VS Code.

git-blame meets narrative history, in one extension.

![Asking @historian why a line is the way it is, with cited commits streamed back as clickable chips](images/screenshots/historian.gif)

---

## `@historian` — ask why

Open the chat panel, mention `@historian`, and ask in plain English. The participant shells out for `git blame`, `git log`, and `git show`, assembles structured evidence — including **trimmed patch excerpts**, **per-commit file stats**, and **associated pull requests or merge requests** (for GitHub, GitLab, and Bitbucket repos) — and streams a grounded explanation. Every cited commit becomes a clickable chip in the response. Follow-up questions stay grounded in prior responses, and when you've picked a diff baseline, `@historian` knows about it.

```
@historian why is this written this way?
@historian /story
@historian /story abc1234       # commit-focused story: motivation + files + context
@historian /since main
@historian /author alice
@historian now focus on 2023 commits  # multi-turn: remembers the file context
```

**Slash commands:**

| Command             | What it does                                                                 |
| ------------------- | ---------------------------------------------------------------------------- |
| _(none / `/why`)_   | Explain the selected lines using blame + file log + scoped diff snippets     |
| `/story`            | Chronological narrative of how the whole file got here                       |
| `/story <sha>`      | Tell the story of a single commit: motivation, files touched, how it fits in |
| `/since <ref>`      | Focus on everything that landed in this file since `<ref>`                   |
| `/author <pattern>` | Filter to one author's commits on the file                                   |

**Pull request context** — when the repo has a GitHub, GitLab, or Bitbucket remote, `@historian` looks up the merge requests / pull requests associated with cited commits and folds the PR title + body into the prompt. GitHub auth is silent via VS Code's built-in provider; GitLab and Bitbucket require personal tokens (see Configuration below). Unauthenticated calls still work for public repos (rate-limited).

**Tool calling** — by default, the model can invoke tools to pull evidence on demand instead of pre-loading everything in the prompt. This keeps responses lean and lets the model ask for precisely what it needs (commit details, diffs, blame, file history, PR data). Toggle it off via `timeTraveller.chat.toolCalling` if your model doesn't support tool use, or set `timeTraveller.chat.maxToolRounds` to cap the number of tool-call iterations (default 5).

**From the File History panel** — every commit row has two chat-triggering actions:

- **Ask `@historian` about this commit** — focuses the question on that commit.
- **Tell the story of this commit** — prefills `@historian /story <sha>` for a commit-focused narrative.

The panel title bar also has a one-click **Ask `@historian` about this file** button for a full `/story` without typing.

> **Requires a language-model provider** (e.g. GitHub Copilot Chat). Without one, the participant falls back gracefully rather than erroring.

---

## Features

### Dynamic baseline diff

The gutter's modify/add/delete decorations normally show changes since `HEAD`. Swap that baseline to **any** git ref with one pick:

- current HEAD, or any branch, tag, or remote branch
- the last 30 commits on the current branch
- `merge-base HEAD main` (and `master` / `develop` / `trunk`, auto-detected local-first, falling back to `origin/<name>`) — the PR-review workflow
- the **last release tag** (newest stable semver; `v`-prefix tolerated, prereleases ignored)
- any stash (`stash@{N}` enumerated automatically)
- a SHA typed by hand

Two scopes: a workspace-wide baseline, and **per-file overrides** that shadow it. The status-bar item reflects the effective baseline and annotates `(file)` when an override is active.

![Gutter diff against a non-HEAD baseline with the File History panel on the left](images/screenshots/gutter-diff.png)

![Sectioned baseline picker: presets, recent commits, branches](images/screenshots/baseline-picker.png)

### File history panel

A sidebar tree under the built-in **Source Control** view, backed by `git log --follow`. For the active file:

- subject, `<author> · <date>`, rich markdown tooltip (short SHA, email, ISO date, full body)
- icons distinguish regular commits, merges, the current baseline, and a synthetic "● Working tree" row when the file is dirty
- rename-following: every rename transition is annotated with "renamed from `<old path>`"
- **primary click** sets the commit as the per-file baseline — the gutter updates without reloading
- inline icons: compare with working tree, compare with previous revision, ask `@historian` about this commit
- context menu: set as baseline (per-file), set as workspace baseline, open at revision, copy SHA / subject, ask `@historian`, tell the story of this commit, **open on GitHub / GitLab / Bitbucket**

**Pagination, filters, and grouping** — the panel loads 50 commits at a time with a virtual **Load more…** row at the bottom. Filter and group from the title bar:

- **Filter by subject/body** (case-insensitive substring match)
- **Toggle hide merge commits**
- **Group by** None / By date (Today / Yesterday / This week / This month / This year / Older) / By author

Active filters show up in the view's description line; **Clear filters** only appears when something is active. State persists per-workspace — your filter survives window reloads.

An in-memory LRU cache keyed by `(repo, file, page)` makes repeat views instant; branch switches, HEAD moves, fetches, and merges invalidate the cache automatically via the built-in Git extension's state events.

![File History panel showing commits with author and relative date](images/screenshots/file-history.png)

### Inline UX

- **Hover on changed lines** shows the last-touching commit (subject · shortSha · author · date), scoped to lines that differ from the current baseline. Toggle via `timeTraveller.hover.enabled`.
- **CodeLens above each hunk** in the gutter diff: "Ask @historian why this changed". Clicking it selects the hunk's lines and opens the chat with `@historian why is this the way it is?`. Toggle via `timeTraveller.codeLens.enabled`.

### Stepping & diff

- **`Step Baseline Backward / Forward`** — walk ±1 commit along the file's log (writes to the per-file slot).
- **`Open Diff with Baseline`** — side-by-side editor using the effective baseline as the left side.

---

## Getting started

1. **Install** — from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=DarrenJaworski.vscode-time-traveller), or `code --install-extension vscode-time-traveller-*.vsix`. A **"Get started with Git Time Traveller"** walkthrough opens automatically on first install and walks you through the four steps below.
2. **Ask `@historian`** — open the chat panel and type `@historian /story` on any tracked file for an instant narrative.
3. **Pick a baseline** — `Time Traveller: Pick Diff Baseline…` from the Command Palette. The gutter updates immediately.
4. **Browse history** — click the Source Control icon in the Activity Bar; the **File History** panel appears below the git views.
5. _(Optional)_ **Sign in to GitHub** — once, from any VS Code feature that prompts for GitHub auth — and `@historian` will start folding PR context into its answers on GitHub-backed repos.

Requires VS Code `^1.95.0` for the stable chat participant + `vscode.lm` APIs.

### Supported hosts

`@historian` works with repos on:

- **GitHub** (github.com) — uses VS Code's built-in GitHub auth
- **GitLab** (gitlab.com) — uses VS Code's GitLab Workflow extension if installed, otherwise requires `timeTraveller.gitlabToken`
- **Bitbucket Cloud** (bitbucket.org) — requires `timeTraveller.bitbucketAppPassword`
- **GitHub Enterprise** — configure via `timeTraveller.enterprise.hosts` and `timeTraveller.gheToken`

For private repos, see Configuration below.

---

## Commands

Workspace-level commands (available in the Command Palette):

| Command                                             | What it does                                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `Time Traveller: Pick Diff Baseline…`               | Sectioned picker: presets, scopes (merge-base, last release), branches, tags, remote branches, stashes, recent commits |
| `Time Traveller: Clear Diff Baseline`               | Fall back to HEAD workspace-wide                                                                                       |
| `Time Traveller: Pick Diff Baseline for This File…` | Same picker, file-scoped                                                                                               |
| `Time Traveller: Clear Per-File Baseline`           | Remove the override; global baseline takes effect again                                                                |
| `Time Traveller: Step Baseline Backward / Forward`  | ±1 commit along `git log --follow`                                                                                     |
| `Time Traveller: Open Diff with Baseline`           | Side-by-side diff editor                                                                                               |
| `Time Traveller: Show Current Baseline`             | Info message with the effective ref                                                                                    |
| `Time Traveller: Filter by subject/body…`           | Filter the File History panel                                                                                          |
| `Time Traveller: Toggle hide merge commits`         | In the File History panel                                                                                              |
| `Time Traveller: Group history by…`                 | None / By date / By author                                                                                             |
| `Time Traveller: Clear filters`                     | Reset filter + grouping state                                                                                          |

History-panel per-row actions aren't listed in the palette — they're only meaningful from the tree.

---

## Configuration

**Chat & Evidence:**

| Setting                                     | Default | Description                                                                                                                                   |
| ------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `timeTraveller.chat.maxBlameEvidenceTokens` | `4000`  | Soft cap on characters of patch/diff evidence per query. Lower it when hitting model context limits.                                          |
| `timeTraveller.chat.toolCalling`            | `true`  | Allow the model to invoke tools to pull evidence on demand (diffs, blame, file history, PRs). Disable if your model doesn't support tool use. |
| `timeTraveller.chat.maxToolRounds`          | `5`     | Maximum number of tool-call iterations per query (1–20).                                                                                      |

**Pull request context & authentication:**

| Setting                              | Default | Description                                                                                                       |
| ------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `timeTraveller.pr.enabled`           | `true`  | Fetch PR/MR context for cited commits. Disable to keep queries fully local.                                       |
| `timeTraveller.gitlabToken`          | (empty) | Personal access token for GitLab MR lookups (when GitLab Workflow extension is not installed). Treat as a secret. |
| `timeTraveller.bitbucketAppPassword` | (empty) | Bitbucket Cloud app password for PR lookups. Treat as a secret.                                                   |
| `timeTraveller.gheToken`             | (empty) | Personal access token for GitHub Enterprise Server PR lookups. Treat as a secret.                                 |
| `timeTraveller.enterprise.hosts`     | `{}`    | Map of self-hosted hostnames to provider types. Example: `{"git.acme.corp": "github-enterprise"}`.                |

**Diff baseline & UI:**

| Setting                          | Default | Description                                                                                                                     |
| -------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `timeTraveller.defaultBaseline`  | `HEAD`  | Default git ref to diff against when no baseline is picked. Pin it to `origin/main` for a steady workspace-wide PR-review view. |
| `timeTraveller.codeLens.enabled` | `true`  | Show the "Ask @historian" CodeLens above each changed hunk.                                                                     |
| `timeTraveller.hover.enabled`    | `true`  | Show the last-touching-commit hover on changed lines.                                                                           |

**Language model selection:** Use VS Code's chat model picker (gear icon in the chat panel) to choose which LLM `@historian` uses. The extension works with any provider exposed via the `vscode.lm` API (GitHub Copilot, Claude for VS Code, Gemini for VS Code, etc.).

---

## How it works

- **`@historian`** builds its prompt from structured evidence — selection excerpt, blame-per-line rollup, referenced commits, file log, **current diff baseline ref** (if set), **trimmed patch excerpts** (`git show --patch` with char/line caps), **per-commit file stats** (`git show --numstat`), and **PR/MR title + body** from GitHub, GitLab, or Bitbucket for cited commits — all assembled by pure helpers in `src/historian/` and `src/pr/`. The orchestrator threads prior responses from the chat history into the message stream for multi-turn awareness, streams the model response, and emits `stream.reference(uri)` per cited commit. A multi-provider PR cache keeps API hits to a minimum (session-scoped, capped at 5 lookups per query).
- **Quick diff** is driven by a `QuickDiffProvider` registered against a custom `git-time-traveller:` URI scheme. Live-baseline URIs carry no query and resolve the ref against the baseline store at read time, so decorations refresh the moment the baseline changes.
- **File history** shells `git log --follow --pretty=<custom>` and parses renames via a pure helper. Paginated with an LRU cache keyed by `(repoRoot, relPath, limit)`, invalidated per-repo on `Repository.state.onDidChange`.

Prefer the built-in Git extension API for repo and ref enumeration; fall back to the `git` CLI where the API doesn't expose what we need (blame, merge-base, stash list, `--numstat`, `--patch`).

---

## Development

```bash
npm install
npm run watch       # incremental compile
# F5 in VS Code — launches the Extension Host with this extension loaded
npm run kitchen-sink  # format:check → lint → typecheck → test → compile → package
```

Tests use Vitest; the `vscode` module is aliased to a hand-rolled mock so pure logic is covered without booting VS Code. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the manual test checklist.

Architecture, conventions, and testing guidance live in [`CLAUDE.md`](./CLAUDE.md). Phasing and in-flight work live in [`ROADMAP.md`](./ROADMAP.md).

---

## License

[MIT](./LICENSE)
