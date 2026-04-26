# Historian Tier B — Chat UX Polish Design

**Date:** 2026-04-26
**Status:** Approved, ready for implementation

## Goal

Make `@historian` responses interactive — clickable buttons, file/range anchors, file trees — and let users feed structured context into the prompt via VS Code's native chat reference and variable systems. Tier A made the participant work correctly; Tier B makes it feel like a first-class VS Code chat citizen.

## Scope

In scope:

1. **`stream.button`** — render action buttons in responses (set baseline, open diff, copy SHA).
2. **`stream.anchor`** — emit clickable file:line anchors when the model cites a location.
3. **`stream.filetree`** — show the files-changed list for `/story <sha>` as an expandable tree, not a flat bullet list.
4. **`request.references`** — honor user-attached `#file`, `#selection`, and `#sym` references in the prompt context.
5. **Chat variable resolvers** — register `#timeTraveller.baseline`, `#timeTraveller.history`, `#timeTraveller.commit` so users can pull our state into any chat (not just `@historian`).

Out of scope (Tier C):

- Tool-calling / `LanguageModelTool` (model-driven evidence pulls).
- Non-GitHub PR providers (GitLab, Bitbucket, GHE).
- Workspace-wide `@workspace`-style retrieval.

---

## Change 1: `stream.button` — actionable responses

**Today:** Responses are markdown only. To set a cited commit as the baseline, the user has to copy the SHA, open the picker, paste — multiple clicks for a single intent.

**After:** Each response carries a cluster of buttons keyed off the cited evidence:

- "Set `<shortSha>` as baseline" → invokes `timeTraveller.history.setBaseline` with the top-cited commit.
- "Open diff vs current baseline" → invokes `timeTraveller.openDiffWithBaseline`.
- "Copy SHA" / "Open commit on remote" — reuse existing history-panel commands.

### Implementation

`stream.button({ command, arguments?, title, tooltip? })` is the chat API surface. Pure helper:

```ts
// src/historian/buttons.ts
export interface ActionButton {
  command: string;
  arguments: unknown[];
  title: string;
  tooltip?: string;
}

export function suggestActionButtons(evidence: Evidence): ActionButton[];
```

Logic:

- If `evidence.referencedCommits[0]` exists → emit "Set as baseline" + "Open diff" buttons targeting that SHA.
- Else if `evidence.blameLines` non-empty → use the most-cited blame SHA.
- Else (no cited commit): no buttons.
- Cap at 3 buttons (any more clutters the UI).

### Tests

- `suggestActionButtons` with referenced commit → emits set-baseline + open-diff.
- With blame-only evidence → uses top blame SHA.
- With no cited commit → empty array.

---

## Change 2: `stream.anchor` — clickable citations

**Today:** When the model says "see `src/foo.ts:42`", that's just markdown text.

**After:** When `@historian` knows the file path and line range for a citation (always true for blame and for selection-scoped responses), it emits `stream.anchor(uri, "src/foo.ts:42")` so the user can click to jump.

### Implementation

After streaming the model response, scan the response text for `(\w+\.\w+):(\d+)` patterns that match a known file in the evidence. Emit anchors before the response ends.

Better: emit anchors _upfront_ alongside `stream.reference` for each cited location. This works because:

- We already know `evidence.selection.relPath` + line range.
- We already know each blame line's `(sha, line)`, and `relPath` is constant.

```ts
// In src/chat.ts handler, after the existing reference loop:
if (evidence.selection) {
  const fileUri = vscode.Uri.file(path.join(repoRoot, evidence.selection.relPath));
  stream.anchor(fileUri, `${evidence.selection.relPath}:${evidence.selection.startLine}`);
}
```

`makeCommitUri` already builds `git-time-traveller:` URIs for cited commits — those continue to use `stream.reference`. Anchors are for _current-tree_ file locations, not historical ones.

### Tests

- Pure: anchor list builder produces correct entries given evidence with/without selection, with/without blame.

---

## Change 3: `stream.filetree` — expandable files-changed view

**Today:** The "Files changed in `<sha>`" section is rendered as markdown bullets in the response body, capped at 20 files with a "and N more" line. Long commits look spammy.

**After:** Instead of writing files-changed into the prompt for `/story <sha>`, emit a `stream.filetree` _outside_ the LLM response. The model still sees them in the prompt for reasoning, but the user sees a clean expandable tree in the chat panel.

### Implementation

```ts
// In handler, before model.sendRequest:
if (commitFocused && commitFiles && commitFiles.size > 0) {
  for (const [sha, files] of commitFiles) {
    const tree: vscode.ChatResponseFileTree[] = files.map((f) => ({
      name: f.path,
      // No nested children — flat list, just as files (one segment per path).
    }));
    stream.filetree(tree, vscode.Uri.file(repoRoot));
  }
}
```

We keep the in-prompt "Files changed in `<sha>`" section so the model can reason about file names. The duplicate is intentional: prompt for grounding, filetree for UX.

### Tests

- N/A — the orchestrator just passes through evidence. The pure logic for what files to surface is already tested in `evidence.test.ts`.

---

## Change 4: `request.references` — honor user-attached files and selections

**Today:** If the user types `@historian #src/utils.ts why was this added?` and attaches a file via `#`, we ignore it. Our evidence comes from the active editor, full stop.

**After:** When `request.references` is non-empty, treat user-attached files as additional context:

- A `#file` reference whose URI is in the same git repo → include its blame and recent log in the evidence (capped tighter than the active file).
- A `#selection` reference → use it as the selection, overriding the editor selection.
- Unsupported reference types (symbols, search results) → ignored, with a single-line "ignored unsupported references" stream note for transparency.

### Type extension

```ts
// src/historian/evidence.ts
export interface Evidence {
  // ...existing
  /** Files attached via `#file` references, with the same shape as the primary
   * file evidence but tighter caps. Empty if no attachments. */
  attachedFiles?: AttachedFileEvidence[];
}

export interface AttachedFileEvidence {
  relPath: string;
  recentCommits: CommitSummary[];
  blameLines?: BlameLine[];
}
```

### Orchestrator changes

In `gatherEvidence`, after resolving the primary file, walk `request.references`:

```ts
for (const ref of request.references ?? []) {
  if (ref.value instanceof vscode.Uri) {
    const refRel = relativeTo(repoRoot, ref.value.fsPath);
    if (!refRel || refRel.startsWith('..')) continue;
    const records = await logFile(repoRoot, refRel, 10); // tighter cap
    attachedFiles.push({ relPath: refRel, recentCommits: records.map(recordToSummary) });
  }
}
```

### Prompt changes

`buildUserPrompt` adds an "Attached files (from user)" section after the primary file log, listing each attached file's `relPath` plus its top 10 commits.

### Tests

- `composeEvidence` carries `attachedFiles` through.
- `buildUserPrompt` emits "Attached files" section when non-empty, omits when empty.
- (Mocked) gather evidence with a synthetic `request.references` array — assert the right SHA list appears.

---

## Change 5: Chat variable resolvers

**Today:** Users can only get history context by mentioning `@historian` directly. There's no way to drop "the current baseline" into a copilot or `@workspace` prompt.

**After:** Register three variable resolvers via `vscode.chat.registerChatVariableResolver`:

| Variable                  | Resolves to                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `#timeTraveller.baseline` | The current effective baseline ref (per-file override or workspace default)                  |
| `#timeTraveller.history`  | The last 10 commits on the active file (subject + shortSha + author + date), as plain text   |
| `#timeTraveller.commit`   | If the user has the history panel selection set, that commit's metadata; else "no selection" |

Each resolver returns a `ChatVariableValue[]` with `level: vscode.ChatVariableLevel.Full`.

### Implementation

```ts
// src/chatVariables.ts
export function registerChatVariables(baseline: BaselineStore): vscode.Disposable[];
```

Each resolver is small and isolated. They reuse existing helpers (`baseline.get`, `logFile`, etc.). `package.json` declares them under `contributes.chatVariables` (new contribution point).

### Tests

- Pure formatters for each variable: given inputs (active file, baseline, log), produce expected text.
- Resolver wiring is glue; smoke-tested.

---

## Files changed

| File                                  | Change                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/chat.ts`                         | Stream button/anchor/filetree emission; request.references walk                               |
| `src/historian/buttons.ts` (new)      | Pure `suggestActionButtons` helper                                                            |
| `src/historian/buttons.test.ts` (new) | Tests for button selection logic                                                              |
| `src/historian/anchors.ts` (new)      | Pure `suggestAnchors` helper for selection + blame anchors                                    |
| `src/historian/anchors.test.ts` (new) | Tests for anchor selection logic                                                              |
| `src/historian/evidence.ts`           | Add `attachedFiles?: AttachedFileEvidence[]` to `Evidence` and `EvidenceInputs`; pass through |
| `src/historian/evidence.test.ts`      | Pass-through tests for attachedFiles                                                          |
| `src/historian/prompt.ts`             | Emit "Attached files" section when present                                                    |
| `src/historian/prompt.test.ts`        | Section emission tests                                                                        |
| `src/chatVariables.ts` (new)          | Register `#timeTraveller.*` variable resolvers                                                |
| `src/chatVariables.test.ts` (new)     | Pure formatter tests for each variable                                                        |
| `src/extension.ts`                    | Wire `registerChatVariables` into activation                                                  |
| `package.json`                        | Add `contributes.chatVariables` entries (3 vars)                                              |
| `src/extension.smoke.test.ts`         | Assert chat variables and new commands are registered                                         |

**Not changed:** `src/historian/followups.ts`, `src/pr/*`, baseline/history view modules.

---

## Testing

All five changes follow the established "pure logic first, mocked boundaries second" rule:

- **Buttons & anchors**: pure functions over `Evidence`. No `vscode` imports.
- **Filetree**: orchestrator-level glue, no new pure logic. Verify by smoke test that the filetree call appears in the response stream.
- **request.references**: extend the evidence type and prompt builder (both pure). Mock `request.references` in a chat handler test.
- **Chat variables**: pure text formatters tested directly; resolver registration covered by smoke test.

The test mock at `test/mocks/vscode.ts` will need new surfaces:

- `ChatResponseStream.button`, `.anchor`, `.filetree`
- `chat.registerChatVariableResolver`
- `ChatVariableLevel.Full`

Extend the mock — don't case-mock per test.

---

## Risk

- **API stability:** `stream.button`, `.anchor`, `.filetree` are stable since VS Code 1.90. Variable resolvers are stable since 1.85. We're at `^1.95.0`, so no proposed-API risk.
- **Button proliferation:** Hard cap at 3 buttons keeps responses readable.
- **Variable resolver name conflicts:** Namespacing with `timeTraveller.` (matching our command prefix) makes collisions vanishingly unlikely.
- **request.references unauthorized files:** A user can attach a file from a different workspace folder. We filter to "must live under the same repo as the active file" — anything else is silently dropped.

## Definition of done

- `npm run kitchen-sink` passes.
- Buttons appear in responses for any query that cites a commit.
- Anchors appear for any query with a selection or blame.
- `/story <sha>` shows a filetree, not a markdown bullet wall.
- `#timeTraveller.baseline` (etc.) resolve in any chat panel, not just `@historian`.
- Smoke test asserts all new contribution points and registrations.
