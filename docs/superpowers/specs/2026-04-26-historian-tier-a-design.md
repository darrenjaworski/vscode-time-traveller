# Historian Tier A — Bug Fixes + Quick Wins Design

**Date:** 2026-04-26
**Status:** Approved, ready for implementation

## Goal

Five targeted fixes to `src/chat.ts`, `src/historian/evidence.ts`, and `src/historian/prompt.ts` that restore broken functionality, respect the user's model picker, and feed baseline context into the prompt. No new architecture, no new files (except tests).

## Scope

In scope:

1. Fix the followup bug — `evidence` missing from return metadata
2. Use `request.model` instead of `vscode.lm.selectChatModels`
3. Fix system prompt sent as User message instead of System message
4. Wire `baseline` into the evidence and prompt
5. Thread `context.history` for multi-turn conversation

Out of scope (Tier B/C):

- `stream.button`, `stream.anchor`, `stream.filetree`
- Tool-calling / `LanguageModelTool`
- `request.references`
- Chat variable resolvers
- GitHub Enterprise / GitLab

---

## Change 1: Fix followup bug (`src/chat.ts`)

**Problem:** `suggestFollowups` in `src/historian/followups.ts` is fully implemented, but the handler returns `{ metadata: { command } }` without `evidence`. The `followupProvider` reads `result.metadata?.evidence`, gets `undefined`, and returns `[]`. Followups never appear.

**Fix:** Change the return statement at the end of the handler from:

```typescript
return { metadata: { command } };
```

To:

```typescript
return { metadata: { command, evidence } };
```

The `evidence` variable is already in scope (returned from `gatherEvidence`). No other changes.

**Type:** The `metadata` field on `ChatResult` is typed as `Record<string, unknown>`, so no interface change is needed. The `followupProvider` already reads `result.metadata?.evidence as Evidence | undefined` — it's ready.

---

## Change 2: Use `request.model` (`src/chat.ts`)

**Problem:** The handler calls `vscode.lm.selectChatModels(selector)` using values from `timeTraveller.chat.modelVendor` and `timeTraveller.chat.modelFamily`. This ignores the model the user has selected in VS Code's model picker and silently returns no model for users with Claude/Gemini providers.

**Fix:** Delete the `selectChatModels` block entirely. Replace:

```typescript
const cfg = vscode.workspace.getConfiguration('timeTraveller.chat');
const vendor = cfg.get<string>('modelVendor') || undefined;
const family = cfg.get<string>('modelFamily') || undefined;
const selector: Record<string, string> = {};
if (vendor) selector.vendor = vendor;
if (family) selector.family = family;
const [model] = await vscode.lm.selectChatModels(selector);
if (!model) {
  stream.markdown('No language model is available…');
  return {};
}
```

With a direct use of `request.model`:

```typescript
const model = request.model;
```

**Config cleanup:** Remove the `timeTraveller.chat.modelVendor` and `timeTraveller.chat.modelFamily` settings from `package.json`'s `contributes.configuration` section.

**Error handling:** `request.model` is always defined when the handler is invoked — VS Code guarantees it. No null-check needed.

---

## Change 3: Fix system message (`src/chat.ts`)

**Problem:** The system prompt is sent as:

```typescript
vscode.LanguageModelChatMessage.User(systemPrompt());
```

This means the grounding instructions (persona, anti-hallucination rules, citation style) are treated as a user turn. Most LM providers give System messages different weight — the persona may not hold.

**Fix:** Change to:

```typescript
vscode.LanguageModelChatMessage.System(systemPrompt());
```

The `messages` array becomes:

```typescript
const messages: vscode.LanguageModelChatMessage[] = [
  vscode.LanguageModelChatMessage.System(systemPrompt()),
  // ...history turns (see Change 5)
  vscode.LanguageModelChatMessage.User(buildUserPrompt(evidence, command, request.prompt ?? '')),
];
```

---

## Change 4: Wire baseline into evidence and prompt

**Problem:** The `baseline` arg passed into `registerHistorianParticipant` and forwarded to `gatherEvidence` is explicitly `void`'d with a TODO comment. The prompt never mentions the current diff baseline — the extension's primary feature.

### 4a. Extend `Evidence` (`src/historian/evidence.ts`)

Add one optional field to the `Evidence` interface:

```typescript
export interface Evidence {
  // ...existing fields...
  /** The user's current diff baseline ref (e.g. "HEAD~3", "main", a full SHA).
   * Undefined when no baseline is set (defaults to HEAD). */
  currentBaseline?: string;
}
```

Update `EvidenceInputs` the same way:

```typescript
export interface EvidenceInputs {
  // ...existing fields...
  currentBaseline?: string;
}
```

Update `composeEvidence` to pass it through:

```typescript
return {
  // ...existing fields...
  currentBaseline: inputs.currentBaseline,
};
```

### 4b. Populate in `gatherEvidence` (`src/chat.ts`)

The `baseline` parameter is already in scope. Read it and pass to `composeEvidence`:

```typescript
const currentBaseline = baseline.get(fileUri) ?? undefined;
// (pass into composeEvidence via the inputs object)
```

Remove `void baseline;`.

### 4c. Add to prompt (`src/historian/prompt.ts`)

In `buildUserPrompt`, after the file/selection section:

```typescript
if (evidence.currentBaseline) {
  sections.push(`Current diff baseline: \`${evidence.currentBaseline}\``);
}
```

---

## Change 5: Multi-turn via `context.history` (`src/chat.ts`)

**Problem:** The handler signature is `async (request, _ctx, stream, token)` — `_ctx` is never read. If the user asks "@historian why is this the way it is?" then follows up "now focus on the 2023 commits", the second request has zero memory of the first answer.

**Fix:** Rename `_ctx` to `ctx` and thread prior response turns into the messages array.

In the messages construction, between the System message and the current User message, insert prior `ChatResponseTurn` content as Assistant messages:

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

const messages: vscode.LanguageModelChatMessage[] = [
  vscode.LanguageModelChatMessage.System(systemPrompt()),
  ...historyMessages,
  vscode.LanguageModelChatMessage.User(buildUserPrompt(evidence, command, request.prompt ?? '')),
];
```

**Note:** `ctx.history` only contains turns from the current session within the same participant. It does not cross participants.

---

## Files changed

| File                             | Change                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/chat.ts`                    | All 5 changes (return metadata, request.model, history, baseline, rename `_ctx`)             |
| `src/historian/evidence.ts`      | Add `currentBaseline?` to `Evidence` and `EvidenceInputs`, pass through in `composeEvidence` |
| `src/historian/prompt.ts`        | Add baseline line in `buildUserPrompt`                                                       |
| `src/historian/evidence.test.ts` | Test `composeEvidence` passes `currentBaseline` through                                      |
| `src/historian/prompt.test.ts`   | Test `buildUserPrompt` emits baseline line when set / omits when absent                      |
| `package.json`                   | Remove `timeTraveller.chat.modelVendor` and `timeTraveller.chat.modelFamily` config entries  |

**Not changed:** `src/extension.smoke.test.ts` (no new contribution points), `src/historian/followups.ts` (already correct), `src/historian/followups.test.ts` (followup behavior unchanged).

---

## Testing

### Pure-logic tests to add/update

**`src/historian/evidence.test.ts`:**

- `composeEvidence` with `currentBaseline: 'main'` → result has `currentBaseline: 'main'`
- `composeEvidence` without `currentBaseline` → result has `currentBaseline: undefined`

**`src/historian/prompt.test.ts`:**

- `buildUserPrompt` with evidence having `currentBaseline: 'abc1234'` → output contains `Current diff baseline: \`abc1234\``
- `buildUserPrompt` with evidence having `currentBaseline: undefined` → output does not contain `Current diff baseline`

### Smoke test

The `followupProvider` returning actual followup suggestions is hard to unit-test (it requires a `ChatResult` value from a live handler invocation). The fix is verified by confirming the evidence-to-metadata path compiles and that `suggestFollowups` is called by the smoke test's structural assertions.

---

## Risk

- **`request.model` removal of config settings:** Anyone who had `timeTraveller.chat.modelVendor` set in their `settings.json` will get a benign "unknown configuration key" warning in VS Code after the upgrade. This is acceptable — the setting no longer does anything useful.
- **`LanguageModelChatMessage.System`:** Not all providers honor System messages (some treat them as User messages internally). Behavior is identical or better — never worse.
- **History token budget:** If a chat session has many long prior turns, the message array grows. This is bounded in practice by the typical session length and the model's context window. No explicit cap is added — YAGNI.

## Definition of done

- `npm run kitchen-sink` passes
- `src/historian/evidence.test.ts` has the two `currentBaseline` pass-through cases
- `src/historian/prompt.test.ts` has the two baseline-in-prompt cases
- `package.json` no longer declares `timeTraveller.chat.modelVendor` or `timeTraveller.chat.modelFamily`
- `_ctx` renamed to `ctx` and `ctx.history` is read
- Handler returns `{ metadata: { command, evidence } }`
- `void baseline;` line removed
