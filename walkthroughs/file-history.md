# Browse file history

The **File History** panel lives in the Source Control sidebar (click the Source Control icon in the Activity Bar). It auto-follows the active editor and shows `git log --follow` for the current file:

- Subject · author · relative date, with a rich tooltip (short SHA, email, ISO date, full body)
- Distinct icons for regular commits, merges, the current baseline, and a synthetic **● Working tree** row when the file is dirty
- Rename-following with "renamed from `<old path>`" on transition rows
- **Primary click** sets the commit as the per-file baseline — gutter updates immediately, no document reload

**Pagination & filters** (title-bar actions):

- _Load more…_ grows the list by 50 commits
- _Filter by subject/body…_ — case-insensitive substring match
- _Toggle hide merge commits_
- _Group history by…_ — None · By date (Today / Yesterday / This week / This month / This year / Older) · By author

Active filters show up in the view's description line and **persist per-workspace** — your filter survives window reloads.

**Per-row context menu** covers: set as baseline (per-file or workspace), open file at revision, compare with working tree / previous revision, ask `@historian`, **tell the story of this commit**, copy SHA / subject, open on GitHub / GitLab / Bitbucket.

**In-editor affordances:**

- **Hover** on a changed line to see the last-touching commit (subject · author · date)
- **CodeLens** above each hunk: "Ask `@historian` why this changed" — one-click chat with the hunk pre-selected
