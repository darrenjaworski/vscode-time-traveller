# Historian Tier A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix five bugs/gaps in the `@historian` chat participant: broken followups, wrong model picker, wrong message role, missing baseline context, and missing multi-turn history.

**Architecture:** All changes are confined to `src/chat.ts` (orchestration), `src/historian/evidence.ts` (data type), and `src/historian/prompt.ts` (prompt builder). No new files, no new architecture. Tests go in existing `*.test.ts` files alongside each module.

**Tech Stack:** TypeScript, Vitest, VS Code Extension API (`vscode.ChatRequestHandler`, `vscode.LanguageModelChatMessage`)

---

### Task 1: Fix the followup bug

**Files:**

- Modify: `src/chat.ts` (last line of handler, `return` statement)

The handler returns `{ metadata: { command } }` — `evidence` is missing, so `followupProvider` always receives `undefined` and returns `[]`. One-line fix.

- [ ] **Step 1: Find the broken return statement**

Open `src/chat.ts` and locate this line near the bottom of the handler (after the `void baseline;` line):

```typescript
return { metadata: { command } };
```

- [ ] **Step 2: Fix the return statement**

Change it to:

```typescript
return { metadata: { command, evidence } };
```

The `evidence` variable is already in scope — it's returned from `gatherEvidence` a few lines above.

- [ ] **Step 3: Verify it compiles**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/chat.ts
git commit -m "fix(historian): pass evidence through to followup provider"
```

---

### Task 2: Add `currentBaseline` to the `Evidence` type (TDD)

**Files:**

- Modify: `src/historian/evidence.ts` (interfaces + `composeEvidence`)
- Modify: `src/historian/evidence.test.ts` (2 new test cases)

- [ ] **Step 1: Write the two failing tests**

In `src/historian/evidence.test.ts`, find the `describe('composeEvidence', ...)` block and add two cases at the end:

```typescript
it('passes currentBaseline through when provided', () => {
  const ev = composeEvidence({ fileRecords: [], currentBaseline: 'main' });
  expect(ev.currentBaseline).toBe('main');
});

it('leaves currentBaseline undefined when not provided', () => {
  const ev = composeEvidence({ fileRecords: [] });
  expect(ev.currentBaseline).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- src/historian/evidence.test.ts
```

Expected: FAIL — `currentBaseline` does not exist on `Evidence` or `EvidenceInputs`

- [ ] **Step 3: Add `currentBaseline` to the `Evidence` interface**

In `src/historian/evidence.ts`, find the `Evidence` interface and add the field after `commitPRs`:

```typescript
export interface Evidence {
  relPath?: string;
  selection?: EvidenceSelection;
  blameLines?: BlameLine[];
  fileCommits: CommitSummary[];
  referencedCommits: CommitSummary[];
  filterDescription?: string;
  commitFiles?: Map<string, CommitFileChange[]>;
  commitDiffs?: Map<string, string>;
  commitPRs?: Map<string, PRSummary>;
  /** The user's active diff baseline ref (e.g. "HEAD~3", "main", a full SHA).
   * Undefined when no baseline is set workspace-wide. */
  currentBaseline?: string;
}
```

- [ ] **Step 4: Add `currentBaseline` to `EvidenceInputs`**

Find the `EvidenceInputs` interface and add the same field:

```typescript
export interface EvidenceInputs {
  relPath?: string;
  selection?: EvidenceSelection;
  blameLines?: BlameLine[];
  fileRecords: RawLogRecord[];
  referencedShas?: string[];
  filterDescription?: string;
  commitFiles?: Map<string, CommitFileChange[]>;
  commitDiffs?: Map<string, string>;
  commitPRs?: Map<string, PRSummary>;
  currentBaseline?: string;
}
```

- [ ] **Step 5: Pass it through in `composeEvidence`**

Find the `return` statement in `composeEvidence` and add the field:

```typescript
return {
  relPath: inputs.relPath,
  selection: inputs.selection,
  blameLines: inputs.blameLines,
  fileCommits,
  referencedCommits,
  filterDescription: inputs.filterDescription,
  commitFiles: inputs.commitFiles,
  commitDiffs: inputs.commitDiffs,
  commitPRs: inputs.commitPRs,
  currentBaseline: inputs.currentBaseline,
};
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
npm test -- src/historian/evidence.test.ts
```

Expected: all tests PASS (including the 2 new ones)

- [ ] **Step 7: Commit**

```bash
git add src/historian/evidence.ts src/historian/evidence.test.ts
git commit -m "feat(historian): add currentBaseline field to Evidence type"
```

---

### Task 3: Emit baseline line in `buildUserPrompt` (TDD)

**Files:**

- Modify: `src/historian/prompt.ts` (`buildUserPrompt` function)
- Modify: `src/historian/prompt.test.ts` (2 new test cases)

- [ ] **Step 1: Write the two failing tests**

In `src/historian/prompt.test.ts`, find the `describe('buildUserPrompt', ...)` block. Add two cases near the top of that block (after the existing task-description tests):

```typescript
it('includes current baseline line when evidence has currentBaseline', () => {
  const ev = baseEv({ currentBaseline: 'abc1234' });
  const prompt = buildUserPrompt(ev, 'default', '');
  expect(prompt).toContain('Current diff baseline: `abc1234`');
});

it('omits baseline line when evidence has no currentBaseline', () => {
  const ev = baseEv();
  const prompt = buildUserPrompt(ev, 'default', '');
  expect(prompt).not.toContain('Current diff baseline');
});
```

Note: `baseEv` is already defined in that test file as a helper that builds a minimal `Evidence` object. Its signature accepts `Partial<Evidence>` overrides, so passing `{ currentBaseline: 'abc1234' }` works once Task 2 is done.

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- src/historian/prompt.test.ts
```

Expected: FAIL — `buildUserPrompt` does not emit a baseline line yet

- [ ] **Step 3: Add the baseline line to `buildUserPrompt`**

In `src/historian/prompt.ts`, find `buildUserPrompt`. After the selection/relPath section (the block that pushes `selectionSection` or the `File:` line) and before the `referencedCommits` section, add:

```typescript
if (evidence.currentBaseline) {
  sections.push(`Current diff baseline: \`${evidence.currentBaseline}\``);
}
```

The full updated `buildUserPrompt` section order becomes:

1. `taskSection(...)`
2. selection or relPath line
3. **`currentBaseline` line** ← new
4. `referencedCommitsSection` (if any)
5. `commitFilesSection` (if any)
6. `commitDiffsSection` (if any)
7. `commitPRsSection` (if any)
8. `blameSection` (if any)
9. `fileLogSection` (if any)
10. `filterDescription` line (if any)

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- src/historian/prompt.test.ts
```

Expected: all tests PASS (including the 2 new ones)

- [ ] **Step 5: Commit**

```bash
git add src/historian/prompt.ts src/historian/prompt.test.ts
git commit -m "feat(historian): include current baseline in prompt"
```

---

### Task 4: Wire `gatherEvidence` to read and pass the baseline

**Files:**

- Modify: `src/chat.ts` (`gatherEvidence` function + `registerHistorianParticipant`)

Now that `Evidence` has the field and `buildUserPrompt` renders it, wire the live baseline value from `BaselineStore` into the evidence.

- [ ] **Step 1: Update `gatherEvidence` to accept and return the baseline**

Find the `GatherInputs` interface in `src/chat.ts`:

```typescript
interface GatherInputs {
  command: HistorianCommand;
  prompt: string;
  editor: vscode.TextEditor | undefined;
  fileUri: vscode.Uri | undefined;
}
```

Add `baseline: BaselineStore` to it:

```typescript
interface GatherInputs {
  command: HistorianCommand;
  prompt: string;
  editor: vscode.TextEditor | undefined;
  fileUri: vscode.Uri | undefined;
  baseline: BaselineStore;
}
```

- [ ] **Step 2: Read the baseline inside `gatherEvidence`**

Inside the `gatherEvidence` function, find the `return composeEvidence({...})` call at the bottom. Add `currentBaseline` to the inputs:

```typescript
return composeEvidence({
  relPath,
  selection,
  blameLines,
  fileRecords: records,
  referencedShas: referencedSha ? [referencedSha] : undefined,
  filterDescription,
  commitFiles,
  commitDiffs: commitDiffs.size > 0 ? commitDiffs : undefined,
  commitPRs: commitPRsRaw.size > 0 ? commitPRsRaw : undefined,
  currentBaseline: inputs.baseline.get(fileUri) ?? undefined,
});
```

- [ ] **Step 3: Pass `baseline` into the `gatherEvidence` call in the handler**

In the handler body, find the `gatherEvidence({...})` call and add `baseline`:

```typescript
const evidence = await gatherEvidence({
  command,
  prompt: request.prompt ?? '',
  editor,
  fileUri,
  baseline,
});
```

- [ ] **Step 4: Remove the `void baseline;` line**

Delete the comment and the `void baseline;` line that comes after the `model.sendRequest` block:

```typescript
// Touch baseline to satisfy unused-var lint; consumed when we extend the
// prompt with "current baseline" context in a later pass.
void baseline;
```

Both lines go. `baseline` is now actually used, so the lint warning is gone.

- [ ] **Step 5: Verify typecheck and run all tests**

```bash
npm run typecheck && npm test
```

Expected: all tests PASS, no type errors

- [ ] **Step 6: Commit**

```bash
git add src/chat.ts
git commit -m "feat(historian): wire current baseline into evidence and prompt"
```

---

### Task 5: Use `request.model` and remove config settings

**Files:**

- Modify: `src/chat.ts` (model selection block)
- Modify: `package.json` (remove 2 config entries)

- [ ] **Step 1: Remove the model selection block in `src/chat.ts`**

Find and delete these lines entirely (approximately lines 57–73 of the handler):

```typescript
const cfg = vscode.workspace.getConfiguration('timeTraveller.chat');
const vendor = cfg.get<string>('modelVendor') || undefined;
const family = cfg.get<string>('modelFamily') || undefined;
const selector: Record<string, string> = {};
if (vendor) selector.vendor = vendor;
if (family) selector.family = family;
const [model] = await vscode.lm.selectChatModels(selector);
if (!model) {
  stream.markdown(
    'No language model is available. Install GitHub Copilot Chat or another provider that exposes `vscode.lm`, then try again.',
  );
  return {};
}
```

Replace with a single line:

```typescript
const model = request.model;
```

- [ ] **Step 2: Remove the two config entries from `package.json`**

In `package.json`, find the `contributes.configuration.properties` section and delete both of these entries completely (including trailing commas as needed):

```json
"timeTraveller.chat.modelFamily": {
  "type": "string",
  "default": "gpt-4o",
  "description": "Preferred language-model family for @historian, passed to `vscode.lm.selectChatModels`. Leave empty to accept whatever the provider offers. Examples: `gpt-4o`, `claude-3.5-sonnet`."
},
"timeTraveller.chat.modelVendor": {
  "type": "string",
  "default": "copilot",
  "description": "Preferred language-model vendor. `copilot` matches GitHub Copilot Chat; leave empty to accept any vendor."
},
```

- [ ] **Step 3: Verify typecheck and run all tests**

```bash
npm run typecheck && npm test
```

Expected: all tests PASS, no type errors

- [ ] **Step 4: Commit**

```bash
git add src/chat.ts package.json
git commit -m "feat(historian): use request.model, remove manual model selector config"
```

---

### Task 6: Fix system message role

**Files:**

- Modify: `src/chat.ts` (messages array construction)

- [ ] **Step 1: Change the system prompt from User to System role**

In `src/chat.ts`, find the `messages` array construction:

```typescript
const messages: vscode.LanguageModelChatMessage[] = [
  vscode.LanguageModelChatMessage.User(systemPrompt()),
  vscode.LanguageModelChatMessage.User(buildUserPrompt(evidence, command, request.prompt ?? '')),
];
```

Change `.User(systemPrompt())` to `.System(systemPrompt())`:

```typescript
const messages: vscode.LanguageModelChatMessage[] = [
  vscode.LanguageModelChatMessage.System(systemPrompt()),
  vscode.LanguageModelChatMessage.User(buildUserPrompt(evidence, command, request.prompt ?? '')),
];
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```

Expected: no errors (`LanguageModelChatMessage.System` is available since VS Code 1.90)

- [ ] **Step 3: Commit**

```bash
git add src/chat.ts
git commit -m "fix(historian): send system prompt as System message, not User"
```

---

### Task 7: Wire `context.history` for multi-turn conversation

**Files:**

- Modify: `src/chat.ts` (handler signature + messages array)

- [ ] **Step 1: Rename `_ctx` to `ctx` in the handler**

Find the handler declaration:

```typescript
const handler: vscode.ChatRequestHandler = async (request, _ctx, stream, token) => {
```

Change to:

```typescript
const handler: vscode.ChatRequestHandler = async (request, ctx, stream, token) => {
```

- [ ] **Step 2: Build history messages from prior turns**

In `src/chat.ts`, just before the `messages` array construction, add the history-extraction block:

```typescript
const historyMessages: vscode.LanguageModelChatMessage[] = [];
for (const turn of ctx.history) {
  if (turn instanceof vscode.ChatResponseTurn) {
    const text = turn.response
      .filter(
        (p): p is vscode.ChatResponseMarkdownPart => p instanceof vscode.ChatResponseMarkdownPart,
      )
      .map((p) => p.value.value)
      .join('');
    if (text.trim()) {
      historyMessages.push(vscode.LanguageModelChatMessage.Assistant(text));
    }
  }
}
```

- [ ] **Step 3: Include history messages in the messages array**

Update the `messages` array to spread `historyMessages` between the system message and the current user message:

```typescript
const messages: vscode.LanguageModelChatMessage[] = [
  vscode.LanguageModelChatMessage.System(systemPrompt()),
  ...historyMessages,
  vscode.LanguageModelChatMessage.User(buildUserPrompt(evidence, command, request.prompt ?? '')),
];
```

- [ ] **Step 4: Verify typecheck and run all tests**

```bash
npm run typecheck && npm test
```

Expected: all tests PASS, no type errors

- [ ] **Step 5: Commit**

```bash
git add src/chat.ts
git commit -m "feat(historian): thread context.history for multi-turn conversation"
```

---

### Task 8: Final verification

**Files:** all modified files

- [ ] **Step 1: Run the full kitchen-sink**

```bash
npm run kitchen-sink
```

Expected: format:check ✓, lint ✓, typecheck ✓, test ✓, compile ✓, package ✓

- [ ] **Step 2: Confirm definition of done**

Check each item:

- `src/historian/evidence.ts` exports `Evidence` with `currentBaseline?`
- `src/historian/evidence.test.ts` has 2 new `currentBaseline` cases, all passing
- `src/historian/prompt.ts` emits `Current diff baseline: \`...\`` when set
- `src/historian/prompt.test.ts` has 2 new baseline-in-prompt cases, all passing
- `src/chat.ts` returns `{ metadata: { command, evidence } }`
- `src/chat.ts` uses `request.model` (no `selectChatModels`)
- `src/chat.ts` sends system prompt as `System` message
- `src/chat.ts` reads `ctx.history` and prepends assistant turns
- `src/chat.ts` passes `baseline` into `gatherEvidence` (no `void baseline;`)
- `package.json` no longer has `timeTraveller.chat.modelFamily` or `timeTraveller.chat.modelVendor`

- [ ] **Step 3: Push**

```bash
git push origin main
```
