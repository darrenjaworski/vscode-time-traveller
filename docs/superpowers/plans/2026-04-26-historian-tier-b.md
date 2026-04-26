# Historian Tier B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@historian` responses interactive (buttons, anchors, file trees), honor user-attached references, and expose chat variable resolvers.

**Architecture:** Five independent feature blocks. Each adds a small pure helper file plus orchestrator glue in `src/chat.ts`. The `Evidence` type grows one optional field (`attachedFiles`). One new top-level module (`src/chatVariables.ts`) wires the resolvers.

**Tech Stack:** TypeScript, Vitest, VS Code Chat API (`stream.button`, `.anchor`, `.filetree`, `chat.registerChatVariableResolver`).

---

### Task 1: Action buttons (TDD)

**Files:**

- Create: `src/historian/buttons.ts`
- Create: `src/historian/buttons.test.ts`
- Modify: `src/chat.ts` (emit buttons after model response)
- Modify: `test/mocks/vscode.ts` (add `stream.button` to the mock)

The model response is markdown-only today. Add up to three contextual buttons after each response, keyed off the top-cited commit.

- [ ] **Step 1: Write failing tests in `src/historian/buttons.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { suggestActionButtons } from './buttons';
import type { Evidence } from './evidence';

const baseEv = (overrides: Partial<Evidence> = {}): Evidence => ({
  fileCommits: [],
  referencedCommits: [],
  ...overrides,
});

describe('suggestActionButtons', () => {
  it('emits set-baseline + open-diff when a referenced commit is present', () => {
    const ev = baseEv({
      referencedCommits: [
        {
          sha: 'a'.repeat(40),
          shortSha: 'aaaaaaa',
          subject: 's',
          body: '',
          authorName: 'A',
          authorEmail: 'a@a',
          authorDate: new Date(),
          isMerge: false,
        },
      ],
    });
    const buttons = suggestActionButtons(ev);
    expect(buttons.map((b) => b.command)).toContain('timeTraveller.history.setBaseline');
    expect(buttons.map((b) => b.command)).toContain('timeTraveller.openDiffWithBaseline');
    expect(buttons.length).toBeLessThanOrEqual(3);
  });

  it('falls back to top blame SHA when no referenced commit', () => {
    const ev = baseEv({
      blameLines: [
        { sha: 'b'.repeat(40), summary: 's', author: 'a', authorTime: 0, line: 1 },
        { sha: 'b'.repeat(40), summary: 's', author: 'a', authorTime: 0, line: 2 },
        { sha: 'c'.repeat(40), summary: 's', author: 'a', authorTime: 0, line: 3 },
      ],
    });
    const buttons = suggestActionButtons(ev);
    expect(buttons[0].arguments[0]).toBe('b'.repeat(40));
  });

  it('returns empty array when no commit can be cited', () => {
    expect(suggestActionButtons(baseEv())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- src/historian/buttons.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `suggestActionButtons`**

Create `src/historian/buttons.ts`:

```typescript
import type { Evidence } from './evidence';

export interface ActionButton {
  command: string;
  arguments: unknown[];
  title: string;
  tooltip?: string;
}

const MAX_BUTTONS = 3;

export function suggestActionButtons(evidence: Evidence): ActionButton[] {
  const sha = pickPrimarySha(evidence);
  if (!sha) return [];
  const shortSha = sha.slice(0, 7);
  return [
    {
      command: 'timeTraveller.history.setBaseline',
      arguments: [sha],
      title: `Set ${shortSha} as baseline`,
      tooltip: 'Make this commit the diff baseline for the current file',
    },
    {
      command: 'timeTraveller.openDiffWithBaseline',
      arguments: [],
      title: 'Open diff vs current baseline',
    },
    {
      command: 'timeTraveller.history.copySha',
      arguments: [sha],
      title: 'Copy SHA',
    },
  ].slice(0, MAX_BUTTONS);
}

function pickPrimarySha(evidence: Evidence): string | undefined {
  if (evidence.referencedCommits.length > 0) return evidence.referencedCommits[0].sha;
  const blame = evidence.blameLines ?? [];
  if (blame.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const l of blame) counts.set(l.sha, (counts.get(l.sha) ?? 0) + 1);
  let topSha: string | undefined;
  let topCount = 0;
  for (const [sha, n] of counts) {
    if (n > topCount) {
      topSha = sha;
      topCount = n;
    }
  }
  return topSha;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- src/historian/buttons.test.ts
```

- [ ] **Step 5: Extend the vscode mock**

In `test/mocks/vscode.ts`, find the `ChatResponseStream` mock and add:

```typescript
button: vi.fn(),
```

(Match the pattern used for the existing `markdown` / `reference` / `progress` methods.)

- [ ] **Step 6: Wire into `src/chat.ts`**

Add an import:

```typescript
import { suggestActionButtons } from './historian/buttons';
```

After the streaming loop completes (after `for await (const chunk of response.text)`) and before `return { metadata: ... }`:

```typescript
for (const btn of suggestActionButtons(evidence)) {
  stream.button({
    command: btn.command,
    arguments: btn.arguments,
    title: btn.title,
    tooltip: btn.tooltip,
  });
}
```

- [ ] **Step 7: Verify typecheck and tests**

```bash
npm run typecheck && npm test
```

- [ ] **Step 8: Commit**

```bash
git add src/historian/buttons.ts src/historian/buttons.test.ts src/chat.ts test/mocks/vscode.ts
git commit -m "feat(historian): emit contextual action buttons after responses"
```

---

### Task 2: Selection & blame anchors (TDD)

**Files:**

- Create: `src/historian/anchors.ts`
- Create: `src/historian/anchors.test.ts`
- Modify: `src/chat.ts` (emit anchors before/after model response)
- Modify: `test/mocks/vscode.ts` (add `stream.anchor`)

Anchors point at _current-tree_ file locations (not historical commits — those use `stream.reference` and stay as-is). Useful when the response refers to a selection or a specific blame line.

- [ ] **Step 1: Write failing tests in `src/historian/anchors.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { suggestAnchors } from './anchors';
import type { Evidence } from './evidence';

const baseEv = (overrides: Partial<Evidence> = {}): Evidence => ({
  fileCommits: [],
  referencedCommits: [],
  ...overrides,
});

describe('suggestAnchors', () => {
  it('emits a selection anchor when evidence has a selection', () => {
    const ev = baseEv({
      selection: { relPath: 'src/foo.ts', startLine: 10, endLine: 20, excerpt: 'x' },
    });
    const out = suggestAnchors(ev);
    expect(out).toContainEqual({ relPath: 'src/foo.ts', line: 10, label: 'src/foo.ts:10' });
  });

  it('emits anchors for distinct blame lines, capped at 5', () => {
    const ev = baseEv({
      blameLines: Array.from({ length: 10 }, (_, i) => ({
        sha: 's',
        summary: 's',
        author: 'a',
        authorTime: 0,
        line: i + 1,
      })),
      selection: { relPath: 'src/foo.ts', startLine: 1, endLine: 10, excerpt: 'x' },
    });
    const out = suggestAnchors(ev);
    expect(out.length).toBeLessThanOrEqual(6); // 1 selection + 5 blame
  });

  it('returns empty when no selection and no blame', () => {
    expect(suggestAnchors(baseEv())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- src/historian/anchors.test.ts
```

- [ ] **Step 3: Implement `suggestAnchors`**

Create `src/historian/anchors.ts`:

```typescript
import type { Evidence } from './evidence';

export interface AnchorTarget {
  relPath: string;
  line: number;
  label: string;
}

const BLAME_ANCHOR_CAP = 5;

export function suggestAnchors(evidence: Evidence): AnchorTarget[] {
  const out: AnchorTarget[] = [];
  if (evidence.selection) {
    out.push({
      relPath: evidence.selection.relPath,
      line: evidence.selection.startLine,
      label: `${evidence.selection.relPath}:${evidence.selection.startLine}`,
    });
  }
  if (evidence.blameLines && evidence.selection) {
    const seen = new Set<number>();
    for (const l of evidence.blameLines) {
      if (out.length >= BLAME_ANCHOR_CAP + 1) break;
      if (seen.has(l.line)) continue;
      seen.add(l.line);
      out.push({
        relPath: evidence.selection.relPath,
        line: l.line,
        label: `line ${l.line}`,
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- src/historian/anchors.test.ts
```

- [ ] **Step 5: Extend the vscode mock**

Add `anchor: vi.fn()` to the `ChatResponseStream` mock.

- [ ] **Step 6: Wire into `src/chat.ts`**

We need `repoRoot` to build the URI. After `gatherEvidence` returns, the orchestrator already resolved `repoRoot`; add it to the `Evidence` (or thread it via a closure). Cleanest: stash it in the closure.

Replace the existing `for (const sha of citedShas(evidence))` loop with:

```typescript
import { suggestAnchors } from './historian/anchors';
import * as path from 'path';

// Capture repoRoot in gatherEvidence by widening the return type to include it,
// OR resolve it again here. Simpler: resolve it again — repo lookup is cached.
const editorForAnchors = vscode.window.activeTextEditor;
const folder = editorForAnchors
  ? vscode.workspace.getWorkspaceFolder(editorForAnchors.document.uri)
  : undefined;

for (const sha of citedShas(evidence)) {
  const uri = makeCommitUri(evidence, sha);
  if (uri) stream.reference(uri);
}

if (folder) {
  for (const a of suggestAnchors(evidence)) {
    const uri = vscode.Uri.file(path.join(folder.uri.fsPath, a.relPath));
    const pos = new vscode.Position(Math.max(0, a.line - 1), 0);
    stream.anchor(new vscode.Location(uri, pos), a.label);
  }
}
```

- [ ] **Step 7: Verify typecheck and tests**

```bash
npm run typecheck && npm test
```

- [ ] **Step 8: Commit**

```bash
git add src/historian/anchors.ts src/historian/anchors.test.ts src/chat.ts test/mocks/vscode.ts
git commit -m "feat(historian): emit clickable anchors for selection and blame lines"
```

---

### Task 3: File-tree rendering for `/story <sha>`

**Files:**

- Modify: `src/chat.ts` (emit `stream.filetree` after gather, before user-prompt build)
- Modify: `test/mocks/vscode.ts` (add `stream.filetree`)

No new pure logic — `evidence.commitFiles` already has the data shaped right. The filetree is a UX surface.

- [ ] **Step 1: Extend the vscode mock**

Add `filetree: vi.fn()` to the `ChatResponseStream` mock.

- [ ] **Step 2: Emit filetree in handler**

In `src/chat.ts`, after the references/anchors loop (so the order in the response is: refs → anchors → filetree → response → buttons):

```typescript
if (evidence.commitFiles && evidence.commitFiles.size > 0 && folder) {
  for (const [, files] of evidence.commitFiles) {
    const tree: vscode.ChatResponseFileTree[] = files.map((f) => ({ name: f.path }));
    stream.filetree(tree, folder.uri);
  }
}
```

`folder` is the same `vscode.WorkspaceFolder` resolved in Task 2.

- [ ] **Step 3: Verify typecheck and tests**

```bash
npm run typecheck && npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/chat.ts test/mocks/vscode.ts
git commit -m "feat(historian): render commit-focused files-changed as a filetree"
```

---

### Task 4a: Extend Evidence with `attachedFiles` (TDD)

**Files:**

- Modify: `src/historian/evidence.ts` (add `AttachedFileEvidence` + `attachedFiles?` field)
- Modify: `src/historian/evidence.test.ts` (pass-through tests)

- [ ] **Step 1: Write failing tests**

Add to `src/historian/evidence.test.ts` inside the `composeEvidence` describe block:

```typescript
it('passes attachedFiles through when provided', () => {
  const attached = [{ relPath: 'src/util.ts', recentCommits: [] }];
  const ev = composeEvidence({ fileRecords: [], attachedFiles: attached });
  expect(ev.attachedFiles).toEqual(attached);
});

it('leaves attachedFiles undefined when not provided', () => {
  const ev = composeEvidence({ fileRecords: [] });
  expect(ev.attachedFiles).toBeUndefined();
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
npm test -- src/historian/evidence.test.ts
```

- [ ] **Step 3: Add the type and pass-through**

In `src/historian/evidence.ts`, add the new interface near the top of the exports:

```typescript
export interface AttachedFileEvidence {
  relPath: string;
  recentCommits: CommitSummary[];
  blameLines?: BlameLine[];
}
```

Add `attachedFiles?: AttachedFileEvidence[]` to both `Evidence` and `EvidenceInputs` (after `currentBaseline`).

In the `composeEvidence` return, add `attachedFiles: inputs.attachedFiles,`.

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- src/historian/evidence.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/historian/evidence.ts src/historian/evidence.test.ts
git commit -m "feat(historian): add attachedFiles field to Evidence type"
```

---

### Task 4b: Render attached files in the prompt (TDD)

**Files:**

- Modify: `src/historian/prompt.ts`
- Modify: `src/historian/prompt.test.ts`

- [ ] **Step 1: Write failing tests in `prompt.test.ts`**

Add inside the `buildUserPrompt` describe:

```typescript
it('emits Attached files section when evidence has attachedFiles', () => {
  const ev = baseEv({
    attachedFiles: [
      {
        relPath: 'src/other.ts',
        recentCommits: [
          {
            sha: 'a'.repeat(40),
            shortSha: 'aaaaaaa',
            subject: 'tweak',
            body: '',
            authorName: 'A',
            authorEmail: 'a@a',
            authorDate: new Date('2026-01-01T00:00:00Z'),
            isMerge: false,
          },
        ],
      },
    ],
  });
  const out = buildUserPrompt(ev, 'default', '');
  expect(out).toContain('Attached files (from user)');
  expect(out).toContain('src/other.ts');
  expect(out).toContain('aaaaaaa');
});

it('omits Attached files section when attachedFiles is empty or undefined', () => {
  const out = buildUserPrompt(baseEv(), 'default', '');
  expect(out).not.toContain('Attached files');
});
```

- [ ] **Step 2: Run to confirm they fail**

- [ ] **Step 3: Add the section to `buildUserPrompt`**

After the `fileLogSection` block (and before `filterDescription`), add:

```typescript
if (evidence.attachedFiles && evidence.attachedFiles.length > 0) {
  sections.push(attachedFilesSection(evidence.attachedFiles, now));
}
```

Add the helper at the end of the file:

```typescript
function attachedFilesSection(files: AttachedFileEvidence[], now: Date): string {
  const blocks = files.map((f) => {
    const head = `- ${f.relPath}`;
    const commits = f.recentCommits
      .slice(0, 10)
      .map(
        (c) =>
          `    - \`${c.shortSha}\` · ${c.authorName} · ${formatSmartTimestamp(c.authorDate, now)} — ${c.subject}`,
      );
    return [head, ...commits].join('\n');
  });
  return ['Attached files (from user):', ...blocks].join('\n');
}
```

Import `AttachedFileEvidence` at the top.

- [ ] **Step 4: Run tests to confirm they pass**

- [ ] **Step 5: Commit**

```bash
git add src/historian/prompt.ts src/historian/prompt.test.ts
git commit -m "feat(historian): render user-attached files in prompt"
```

---

### Task 4c: Wire `request.references` in `gatherEvidence`

**Files:**

- Modify: `src/chat.ts`

- [ ] **Step 1: Add references parameter to `GatherInputs`**

```typescript
interface GatherInputs {
  command: HistorianCommand;
  prompt: string;
  editor: vscode.TextEditor | undefined;
  fileUri: vscode.Uri | undefined;
  baseline: BaselineStore;
  references: readonly vscode.ChatPromptReference[];
}
```

- [ ] **Step 2: Pass `request.references` from the handler**

```typescript
const evidence = await gatherEvidence({
  command,
  prompt: request.prompt ?? '',
  editor,
  fileUri,
  baseline,
  references: request.references ?? [],
});
```

- [ ] **Step 3: Walk references inside `gatherEvidence`**

Before the final `return composeEvidence({...})`, add:

```typescript
const attachedFiles: AttachedFileEvidence[] = [];
for (const ref of inputs.references) {
  const value = ref.value;
  if (value instanceof vscode.Uri) {
    if (value.scheme !== 'file') continue;
    const refRel = relativeTo(repoRoot, value.fsPath);
    if (!refRel || refRel.startsWith('..') || refRel === relPath) continue;
    const records = await logFile(repoRoot, refRel, 10);
    attachedFiles.push({ relPath: refRel, recentCommits: records.map(recordToSummary) });
  }
}
```

Import `AttachedFileEvidence` and `recordToSummary` from `./historian/evidence`.

Pass `attachedFiles: attachedFiles.length > 0 ? attachedFiles : undefined` into `composeEvidence`.

- [ ] **Step 4: Verify typecheck and tests**

```bash
npm run typecheck && npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/chat.ts
git commit -m "feat(historian): honor request.references for attached files"
```

---

### Task 5a: Pure formatters for chat variables (TDD)

**Files:**

- Create: `src/chatVariables.ts` (formatters only, no `vscode` registration yet)
- Create: `src/chatVariables.test.ts`

- [ ] **Step 1: Write failing tests in `src/chatVariables.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { formatBaselineValue, formatHistoryValue, formatCommitValue } from './chatVariables';

describe('formatBaselineValue', () => {
  it('emits the ref when set', () => {
    expect(formatBaselineValue('main')).toBe('Current diff baseline: `main`');
  });
  it('emits "no baseline" when undefined', () => {
    expect(formatBaselineValue(undefined)).toBe('No diff baseline set (defaults to HEAD)');
  });
});

describe('formatHistoryValue', () => {
  it('formats a list of commits', () => {
    const out = formatHistoryValue('src/foo.ts', [
      {
        shortSha: 'aaa1234',
        subject: 'first',
        authorName: 'Alice',
        authorDate: new Date('2026-01-01'),
      },
    ]);
    expect(out).toContain('src/foo.ts');
    expect(out).toContain('aaa1234');
    expect(out).toContain('Alice');
    expect(out).toContain('first');
  });
  it('handles empty history', () => {
    expect(formatHistoryValue('src/foo.ts', [])).toContain('No commits');
  });
});

describe('formatCommitValue', () => {
  it('formats a commit when provided', () => {
    const out = formatCommitValue({
      shortSha: 'abc1234',
      subject: 'fix',
      authorName: 'A',
      authorDate: new Date('2026-01-01'),
      body: 'detail',
    });
    expect(out).toContain('abc1234');
    expect(out).toContain('fix');
    expect(out).toContain('detail');
  });
  it('returns "no selection" when undefined', () => {
    expect(formatCommitValue(undefined)).toBe('No commit selected in the History panel');
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

- [ ] **Step 3: Implement formatters**

Create `src/chatVariables.ts`:

```typescript
export interface CommitForVariable {
  shortSha: string;
  subject: string;
  authorName: string;
  authorDate: Date;
  body?: string;
}

export function formatBaselineValue(ref: string | undefined): string {
  return ref ? `Current diff baseline: \`${ref}\`` : 'No diff baseline set (defaults to HEAD)';
}

export function formatHistoryValue(relPath: string, commits: CommitForVariable[]): string {
  if (commits.length === 0) {
    return `No commits found for ${relPath}.`;
  }
  const lines = commits.map(
    (c) =>
      `- \`${c.shortSha}\` · ${c.authorName} · ${c.authorDate.toISOString().slice(0, 10)} — ${c.subject}`,
  );
  return [`Recent commits for ${relPath}:`, ...lines].join('\n');
}

export function formatCommitValue(commit: CommitForVariable | undefined): string {
  if (!commit) return 'No commit selected in the History panel';
  const head = `\`${commit.shortSha}\` · ${commit.authorName} · ${commit.authorDate.toISOString().slice(0, 10)} — ${commit.subject}`;
  return commit.body ? `${head}\n\n${commit.body}` : head;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

- [ ] **Step 5: Commit**

```bash
git add src/chatVariables.ts src/chatVariables.test.ts
git commit -m "feat(chat-variables): pure formatters for baseline, history, commit"
```

---

### Task 5b: Register chat variable resolvers

**Files:**

- Modify: `src/chatVariables.ts` (add `registerChatVariables` function)
- Modify: `src/extension.ts` (call it in activation)
- Modify: `package.json` (declare `contributes.chatVariables`)
- Modify: `test/mocks/vscode.ts` (add `chat.registerChatVariableResolver`)
- Modify: `src/extension.smoke.test.ts` (assert registration)

- [ ] **Step 1: Add `registerChatVariables` function**

Append to `src/chatVariables.ts`:

```typescript
import * as vscode from 'vscode';
import type { BaselineStore } from './baseline';
import { findRepository } from './git/api';
import { logFile, relativeTo } from './git/cli';

export function registerChatVariables(baseline: BaselineStore): vscode.Disposable[] {
  const resolveBaseline = vscode.chat.registerChatVariableResolver(
    'timeTraveller.baseline',
    'timeTraveller.baseline',
    'The current diff baseline ref',
    'The git ref the gutter is diffing against',
    false,
    {
      resolve: () => {
        const editor = vscode.window.activeTextEditor;
        const ref = editor ? baseline.get(editor.document.uri) : baseline.get(undefined);
        return [{ level: vscode.ChatVariableLevel.Full, value: formatBaselineValue(ref) }];
      },
    },
    'Time Traveller baseline',
  );

  const resolveHistory = vscode.chat.registerChatVariableResolver(
    'timeTraveller.history',
    'timeTraveller.history',
    'Recent commits on the active file',
    'Top 10 commits from `git log --follow` on the active editor',
    false,
    {
      resolve: async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.scheme !== 'file') {
          return [
            {
              level: vscode.ChatVariableLevel.Full,
              value: 'No active file to read history from',
            },
          ];
        }
        const repo = await findRepository(editor.document.uri);
        if (!repo) {
          return [
            { level: vscode.ChatVariableLevel.Full, value: 'Active file is not in a git repo' },
          ];
        }
        const repoRoot = repo.rootUri.fsPath;
        const relPath = relativeTo(repoRoot, editor.document.uri.fsPath);
        if (!relPath) {
          return [
            { level: vscode.ChatVariableLevel.Full, value: 'Active file is not in a git repo' },
          ];
        }
        const records = await logFile(repoRoot, relPath, 10);
        const commits = records.map((r) => ({
          shortSha: r.shortSha,
          subject: r.subject,
          authorName: r.authorName,
          authorDate: new Date(r.authorDate),
        }));
        return [
          { level: vscode.ChatVariableLevel.Full, value: formatHistoryValue(relPath, commits) },
        ];
      },
    },
    'Time Traveller history',
  );

  // Commit variable: tracks last selected row in the History panel via a
  // global memento key set by `view.ts` when a row is focused.
  const resolveCommit = vscode.chat.registerChatVariableResolver(
    'timeTraveller.commit',
    'timeTraveller.commit',
    'The currently selected History panel commit',
    'The commit currently focused in the Time Traveller File History view',
    false,
    {
      resolve: () => [
        // The history view writes `historian.lastFocusedCommit` to globalState
        // when a row is selected; resolve reads it back.
        // For now, return "no selection" — the wire-up in view.ts is a follow-up.
        { level: vscode.ChatVariableLevel.Full, value: formatCommitValue(undefined) },
      ],
    },
    'Time Traveller commit',
  );

  return [resolveBaseline, resolveHistory, resolveCommit];
}
```

- [ ] **Step 2: Wire into `src/extension.ts` activation**

Find the `activate` function. After `baseline` is constructed:

```typescript
context.subscriptions.push(...registerChatVariables(baseline));
```

Import at the top:

```typescript
import { registerChatVariables } from './chatVariables';
```

- [ ] **Step 3: Declare in `package.json`**

In `contributes`, add:

```json
"chatVariables": [
  {
    "name": "timeTraveller.baseline",
    "description": "Current diff baseline ref"
  },
  {
    "name": "timeTraveller.history",
    "description": "Recent commits on the active file"
  },
  {
    "name": "timeTraveller.commit",
    "description": "Currently selected History panel commit"
  }
]
```

- [ ] **Step 4: Extend the vscode mock**

In `test/mocks/vscode.ts`, add to the `chat` namespace:

```typescript
registerChatVariableResolver: vi.fn(() => ({ dispose: () => {} })),
```

And add the `ChatVariableLevel` enum:

```typescript
export const ChatVariableLevel = { Short: 1, Medium: 2, Full: 3 } as const;
```

- [ ] **Step 5: Update the smoke test**

In `src/extension.smoke.test.ts`, after the existing chat-participant assertion:

```typescript
expect(vscode.chat.registerChatVariableResolver).toHaveBeenCalledWith(
  'timeTraveller.baseline',
  expect.anything(),
  expect.anything(),
  expect.anything(),
  expect.anything(),
  expect.anything(),
  expect.anything(),
);
```

(Or just assert `toHaveBeenCalledTimes(3)`.)

- [ ] **Step 6: Verify typecheck and full test suite**

```bash
npm run typecheck && npm test
```

- [ ] **Step 7: Commit**

```bash
git add src/chatVariables.ts src/extension.ts package.json test/mocks/vscode.ts src/extension.smoke.test.ts
git commit -m "feat(chat-variables): register #timeTraveller.{baseline,history,commit} resolvers"
```

---

### Task 6: Final verification

**Files:** all modified files

- [ ] **Step 1: Run kitchen-sink**

```bash
npm run kitchen-sink
```

Expected: format:check ✓, lint ✓, typecheck ✓, test ✓, compile ✓, package ✓

- [ ] **Step 2: Definition of done**

- `src/historian/buttons.ts` exists with `suggestActionButtons`; tests pass.
- `src/historian/anchors.ts` exists with `suggestAnchors`; tests pass.
- `src/historian/evidence.ts` has `attachedFiles?: AttachedFileEvidence[]`.
- `src/historian/prompt.ts` renders `Attached files (from user)` section.
- `src/chat.ts` emits buttons, anchors, filetree, and walks `request.references`.
- `src/chatVariables.ts` registers three resolvers.
- `package.json` declares `contributes.chatVariables` with three entries.
- Smoke test asserts the three resolvers are registered.

- [ ] **Step 3: Update CHANGELOG**

Add to `[Unreleased]`:

```markdown
### Added (Tier B)

- **Action buttons** — responses end with up to three contextual buttons (Set as baseline, Open diff, Copy SHA).
- **Clickable anchors** — selection and blame line numbers in responses are clickable.
- **File tree for `/story <sha>`** — files-changed render as a navigable tree, not a markdown wall.
- **Attached files** — drag a file into the chat with `#` and `@historian` will include its history as context.
- **Chat variables** — `#timeTraveller.baseline`, `#timeTraveller.history`, `#timeTraveller.commit` work in any chat (Copilot, `@workspace`, etc.).
```

Commit:

```bash
git add CHANGELOG.md
git commit -m "docs: changelog entries for Tier B"
```

- [ ] **Step 4: Push**

```bash
git push origin main
```
