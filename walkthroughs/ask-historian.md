# Ask `@historian` why

`@historian` is a chat participant that narrates _why_ a line of code is the way it is — grounded in real commit history, not guesswork.

Open the chat panel, mention `@historian`, and ask in plain English. The participant shells out for `git blame`, `git log`, and `git show`, assembles structured evidence — selection excerpt, blame rollup, referenced commits, trimmed patch snippets, per-commit file stats, and (on GitHub repos) associated pull requests — and streams a grounded answer. Every cited commit becomes a clickable chip.

**Slash commands:**

- `/why` _(default)_ — explain the selected lines using blame + file log + diff snippets
- `/story` — chronological narrative of how this file got to its current shape
- `/story <sha>` — tell the story of a single commit
- `/since <ref>` — focus on everything that landed since a given ref
- `/author <pattern>` — filter the history to one author

**Requires** a language-model provider (e.g. GitHub Copilot Chat). Without one, `@historian` degrades gracefully instead of erroring.

> **Tip:** From the **File History** panel (Source Control sidebar), right-click any commit row → "Tell the story of this commit" for a one-click commit-focused narrative.
