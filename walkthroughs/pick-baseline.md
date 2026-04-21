# Pick a diff baseline

VS Code's gutter normally shows changes since `HEAD`. Time Traveller lets you pin the baseline to **any** git ref, and the gutter updates in place.

The sectioned picker offers:

- **Presets** — HEAD, clear baseline, or type a SHA / ref by hand
- **Scopes** — `merge-base HEAD main` (and `master` / `develop` / `trunk`, auto-detected) and the last release tag
- **Branches · Tags · Remote branches**
- **Stashes** (enumerated via `git stash list`)
- **Recent commits** on the current branch

Two scopes:

- **Workspace baseline** — applies to every file in the workspace
- **Per-file override** — shadows the workspace baseline for a single file. The status bar annotates `(file)` when an override is active.

**Try it:**

- _Pick a baseline…_ → runs the picker
- _Pick a baseline for this file…_ → same picker, file-scoped
- _Step ±1 commit_ → walk the active file's log one commit at a time

> **Tip:** Right-click any row in the File History panel to set it as the per-file baseline with one click.
