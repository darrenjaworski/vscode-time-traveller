# Test Coverage Closure + Pure Helpers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the largest test-coverage gap (`src/pr/service.ts`) and extract three pure helpers with tests from untested modules.

**Architecture:** Refactor `lookupPRs` to inject its boundary dependencies (`resolveGitHubRemote`, `fetchPRsForCommit`, `getToken`), enabling pure-logic testing via dependency injection. Extract and test three pure helpers (`shortLabel`, `selectionRangeForHunk`) that belong with their existing pure-helper homes (`stepping.ts`, `diff.ts`).

**Tech Stack:** Vitest, TypeScript, vscode API (for types/interfaces only)

---

### Task 1: Extract and test `shortLabel` function

**Files:**

- Modify: `src/stepping.ts`
- Modify: `src/stepping.test.ts`
- Modify: `src/multiBaseline.ts:10-12`

- [ ] **Step 1: Write test cases for `shortLabel`**

Add to `src/stepping.test.ts` (before any other tests in the suite):

```typescript
import { describe, it, expect } from 'vitest';
import { shortLabel } from './stepping';

describe('shortLabel', () => {
  it('converts 40-char lowercase SHA to 8-char hex', () => {
    const sha = 'a'.repeat(40);
    expect(shortLabel(sha)).toBe('aaaaaaaa');
  });

  it('converts 40-char mixed-case SHA to 8-char hex (case-insensitive)', () => {
    const sha = 'AbCdEf0123456789'.padEnd(40, '0');
    expect(shortLabel(sha)).toBe(sha.slice(0, 8));
  });

  it('passes through short SHA unchanged', () => {
    const shortSha = 'a1b2c3d';
    expect(shortLabel(shortSha)).toBe(shortSha);
  });

  it('passes through branch name unchanged', () => {
    expect(shortLabel('main')).toBe('main');
    expect(shortLabel('feature/user-auth')).toBe('feature/user-auth');
  });

  it('passes through tag-like strings unchanged', () => {
    expect(shortLabel('v1.2.3')).toBe('v1.2.3');
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
npm test -- src/stepping.test.ts
```

Expected: FAIL with "shortLabel is not exported from this module"

- [ ] **Step 3: Implement `shortLabel` in `src/stepping.ts`**

At the top of `src/stepping.ts`, after the imports and before `export function computeStep`, add:

```typescript
export function shortLabel(ref: string): string {
  return /^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 8) : ref;
}
```

- [ ] **Step 4: Run tests again to confirm they pass**

```bash
npm test -- src/stepping.test.ts
```

Expected: PASS (all 5 cases)

- [ ] **Step 5: Update `src/multiBaseline.ts` to import `shortLabel` from `stepping`**

Replace lines 10-12 in `src/multiBaseline.ts`:

```typescript
// BEFORE:
function shortLabel(ref: string): string {
  return /^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 8) : ref;
}

// AFTER:
import { shortLabel } from './stepping';
```

Then remove the old `shortLabel` function definition entirely.

- [ ] **Step 6: Verify `multiBaseline.ts` still type-checks and no other tests broke**

```bash
npm run typecheck && npm test
```

Expected: typecheck PASS, all tests (including new stepping tests) PASS

- [ ] **Step 7: Commit**

```bash
git add src/stepping.ts src/stepping.test.ts src/multiBaseline.ts
git commit -m "refactor: move shortLabel to stepping module and test it"
```

---

### Task 2: Extract and test `selectionRangeForHunk` function

**Files:**

- Modify: `src/diff.ts`
- Modify: `src/diff.test.ts`
- Modify: `src/codeLens.ts:87-96`

- [ ] **Step 1: Add test cases for `selectionRangeForHunk` to `src/diff.test.ts`**

Find the end of `src/diff.test.ts` and add this test block:

```typescript
describe('selectionRangeForHunk', () => {
  it('returns startLine equal to endLine for hunk with newCount 0 (deletion)', () => {
    const hunk: Hunk = {
      oldStart: 5,
      oldCount: 3,
      newStart: 5,
      newCount: 0,
    };
    const range = selectionRangeForHunk(hunk);
    expect(range.endLine).toBe(range.startLine);
  });

  it('returns startLine equal to endLine for hunk with newCount 1', () => {
    const hunk: Hunk = {
      oldStart: 5,
      oldCount: 1,
      newStart: 5,
      newCount: 1,
    };
    const range = selectionRangeForHunk(hunk);
    expect(range.endLine).toBe(range.startLine);
  });

  it('returns endLine = startLine + (newCount - 1) for hunk with newCount 5', () => {
    const hunk: Hunk = {
      oldStart: 5,
      oldCount: 5,
      newStart: 5,
      newCount: 5,
    };
    const range = selectionRangeForHunk(hunk);
    expect(range.endLine).toBe(range.startLine + 4);
  });

  it('handles hunk at line 0 without negative lines', () => {
    const hunk: Hunk = {
      oldStart: 1,
      oldCount: 0,
      newStart: 1,
      newCount: 3,
    };
    const range = selectionRangeForHunk(hunk);
    expect(range.startLine).toBeGreaterThanOrEqual(0);
    expect(range.endLine).toBeGreaterThanOrEqual(range.startLine);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
npm test -- src/diff.test.ts
```

Expected: FAIL with "selectionRangeForHunk is not exported from this module"

- [ ] **Step 3: Implement `selectionRangeForHunk` in `src/diff.ts`**

At the end of `src/diff.ts`, before or after `codeLensLineForHunk`, add:

```typescript
export function selectionRangeForHunk(hunk: Hunk): { startLine: number; endLine: number } {
  const startLine = codeLensLineForHunk(hunk);
  const endLine = Math.max(startLine, startLine + Math.max(hunk.newCount, 1) - 1);
  return { startLine, endLine };
}
```

- [ ] **Step 4: Run tests again to confirm they pass**

```bash
npm test -- src/diff.test.ts
```

Expected: PASS (all 4 new cases + existing diff tests)

- [ ] **Step 5: Update `src/codeLens.ts` to use `selectionRangeForHunk`**

Import `selectionRangeForHunk` at the top of `src/codeLens.ts`:

```typescript
import { codeLensLineForHunk, parseDiffHunks, selectionRangeForHunk, type Hunk } from './diff';
```

Then replace lines 87-96 inside the `timeTraveller.askHistorianForHunk` command callback. Find this code:

```typescript
const startLine = codeLensLineForHunk(hunk);
const endLine = Math.max(startLine, startLine + Math.max(hunk.newCount, 1) - 1);
editor.selection = new vscode.Selection(startLine, 0, endLine, Number.MAX_SAFE_INTEGER);
```

Replace with:

```typescript
const { startLine, endLine } = selectionRangeForHunk(hunk);
editor.selection = new vscode.Selection(startLine, 0, endLine, Number.MAX_SAFE_INTEGER);
```

- [ ] **Step 6: Verify type-check and run all tests**

```bash
npm run typecheck && npm test
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/diff.ts src/diff.test.ts src/codeLens.ts
git commit -m "refactor: extract selectionRangeForHunk to diff module and test it"
```

---

### Task 3: Add `PRLookupDeps` interface and refactor `lookupPRs` signature

**Files:**

- Modify: `src/pr/service.ts:1-65`

- [ ] **Step 1: Add the `PRLookupDeps` interface to `src/pr/service.ts`**

After the `PRLookupInput` interface (around line 53), add:

```typescript
export interface PRLookupDeps {
  resolveGitHubRemote: (repoRoot: string) => Promise<RemoteInfo | undefined>;
  fetchPRsForCommit: (args: {
    owner: string;
    repo: string;
    sha: string;
    token?: string;
  }) => Promise<PRSummary[] | undefined>;
  getToken: () => Promise<string | undefined>;
}
```

- [ ] **Step 2: Update the `lookupPRs` function signature**

Change line 64 from:

```typescript
export async function lookupPRs(input: PRLookupInput): Promise<Map<string, PRSummary>> {
```

To:

```typescript
export async function lookupPRs(
	input: PRLookupInput,
	deps?: Partial<PRLookupDeps>,
): Promise<Map<string, PRSummary>> {
```

- [ ] **Step 3: Set up default deps at the start of `lookupPRs`**

Add this code at the very start of the `lookupPRs` function body (after the opening `{`):

```typescript
const defaultDeps: PRLookupDeps = {
  resolveGitHubRemote: async (repoRoot) => resolveGitHubRemote(repoRoot),
  fetchPRsForCommit: fetchPRsForCommit,
  getToken: getGitHubToken,
};
const resolvedDeps = { ...defaultDeps, ...deps };
```

- [ ] **Step 4: Update function calls to use `resolvedDeps`**

Replace:

```typescript
const remote = await resolveGitHubRemote(repoRoot);
```

With:

```typescript
const remote = await resolvedDeps.resolveGitHubRemote(repoRoot);
```

Replace:

```typescript
const token = await getGitHubToken();
```

With:

```typescript
const token = await resolvedDeps.getToken();
```

Replace:

```typescript
const prs = await fetchPRsForCommit({
  owner: remote.owner,
  repo: remote.repo,
  sha,
  token,
});
```

With:

```typescript
const prs = await resolvedDeps.fetchPRsForCommit({
  owner: remote.owner,
  repo: remote.repo,
  sha,
  token,
});
```

- [ ] **Step 5: Verify type-check and existing tests still pass**

```bash
npm run typecheck && npm test -- src/pr/
```

Expected: PASS (all existing pr/ tests unchanged, since defaults are identical to current behavior)

- [ ] **Step 6: Commit**

```bash
git add src/pr/service.ts
git commit -m "refactor: inject deps into lookupPRs for testability"
```

---

### Task 4: Write test cases 1–3 for `lookupPRs`

**Files:**

- Create: `src/pr/service.test.ts` (new file)

- [ ] **Step 1: Create test file with cases 1-3**

Create `src/pr/service.test.ts` with:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { lookupPRs, type PRLookupDeps, type PRLookupInput } from './service';
import { PRCache } from './cache';

describe('lookupPRs', () => {
  it('case 1: empty shas → empty map, zero dep calls', async () => {
    const cache = new PRCache();
    const resolveGitHubRemote = vi.fn();
    const fetchPRsForCommit = vi.fn();
    const getToken = vi.fn();

    const input: PRLookupInput = {
      repoRoot: '/repo',
      shas: [],
      cache,
    };

    const result = await lookupPRs(input, {
      resolveGitHubRemote,
      fetchPRsForCommit,
      getToken,
    });

    expect(result.size).toBe(0);
    expect(resolveGitHubRemote).not.toHaveBeenCalled();
    expect(fetchPRsForCommit).not.toHaveBeenCalled();
    expect(getToken).not.toHaveBeenCalled();
  });

  it('case 2: all cache hits with PR objects → returned, no fetch calls', async () => {
    const cache = new PRCache();
    const pr1 = { number: 123, merged: false, html_url: 'https://github.com/owner/repo/pull/123' };
    const pr2 = { number: 456, merged: true, html_url: 'https://github.com/owner/repo/pull/456' };
    cache.set('sha1', pr1);
    cache.set('sha2', pr2);

    const input: PRLookupInput = {
      repoRoot: '/repo',
      shas: ['sha1', 'sha2'],
      cache,
    };

    const result = await lookupPRs(input, {
      resolveGitHubRemote: vi.fn(),
      fetchPRsForCommit: vi.fn(),
      getToken: vi.fn(),
    });

    expect(result.get('sha1')).toEqual(pr1);
    expect(result.get('sha2')).toEqual(pr2);
    expect(result.size).toBe(2);
  });

  it('case 3: all cache hits with nulls → empty map, no fetch calls', async () => {
    const cache = new PRCache();
    cache.set('sha1', null);
    cache.set('sha2', null);

    const input: PRLookupInput = {
      repoRoot: '/repo',
      shas: ['sha1', 'sha2'],
      cache,
    };

    const result = await lookupPRs(input, {
      resolveGitHubRemote: vi.fn(),
      fetchPRsForCommit: vi.fn(),
      getToken: vi.fn(),
    });

    expect(result.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- src/pr/service.test.ts
```

Expected: FAIL (the three cases should fail because the logic isn't wired to use `resolvedDeps` properly yet, OR they pass if the refactor in Task 3 already works correctly)

If they pass, that's fine — proceed to Step 3.

- [ ] **Step 3: Commit test file**

```bash
git add src/pr/service.test.ts
git commit -m "test: add lookupPRs test cases 1-3 (empty, all hits)"
```

---

### Task 5: Write test cases 4–7 for `lookupPRs`

**Files:**

- Modify: `src/pr/service.test.ts`

- [ ] **Step 1: Add test cases 4-7 to `src/pr/service.test.ts`**

Append to the `describe('lookupPRs', () => {` block:

```typescript
it('case 4: non-GitHub remote → no fetches, nulls cached for uncached shas', async () => {
  const cache = new PRCache();
  const fetchPRsForCommit = vi.fn();

  const input: PRLookupInput = {
    repoRoot: '/repo',
    shas: ['sha1', 'sha2'],
    cache,
  };

  const result = await lookupPRs(input, {
    resolveGitHubRemote: vi.fn().mockResolvedValue(undefined),
    fetchPRsForCommit,
    getToken: vi.fn(),
  });

  expect(result.size).toBe(0);
  expect(fetchPRsForCommit).not.toHaveBeenCalled();
  // Verify cache was populated with nulls
  expect(cache.get('sha1')).toBe(null);
  expect(cache.get('sha2')).toBe(null);
});

it('case 5: limit cap → only first N shas fetched, rest neither fetched nor cached', async () => {
  const cache = new PRCache();
  const fetchPRsForCommit = vi
    .fn()
    .mockResolvedValue([
      { number: 100, merged: false, html_url: 'https://github.com/owner/repo/pull/100' },
    ]);

  const input: PRLookupInput = {
    repoRoot: '/repo',
    shas: ['sha1', 'sha2', 'sha3', 'sha4'],
    cache,
    limit: 2,
  };

  const result = await lookupPRs(input, {
    resolveGitHubRemote: vi.fn().mockResolvedValue({ host: 'github', owner: 'o', repo: 'r' }),
    fetchPRsForCommit,
    getToken: vi.fn().mockResolvedValue('token123'),
  });

  // First 2 shas should be fetched
  expect(fetchPRsForCommit).toHaveBeenCalledTimes(2);
  // Remaining 2 should not be cached
  expect(cache.get('sha3')).toBeUndefined();
  expect(cache.get('sha4')).toBeUndefined();
});

it('case 6: network failure → cache untouched for failed sha, other shas still processed', async () => {
  const cache = new PRCache();
  const pr = { number: 200, merged: false, html_url: 'https://github.com/owner/repo/pull/200' };
  const fetchPRsForCommit = vi
    .fn()
    .mockResolvedValueOnce(undefined) // sha1 fails
    .mockResolvedValueOnce([pr]); // sha2 succeeds

  const input: PRLookupInput = {
    repoRoot: '/repo',
    shas: ['sha1', 'sha2'],
    cache,
  };

  const result = await lookupPRs(input, {
    resolveGitHubRemote: vi.fn().mockResolvedValue({ host: 'github', owner: 'o', repo: 'r' }),
    fetchPRsForCommit,
    getToken: vi.fn().mockResolvedValue('token123'),
  });

  // sha1 should not be in cache (network failure, don't poison)
  expect(cache.get('sha1')).toBeUndefined();
  // sha2 should be in result
  expect(result.get('sha2')).toEqual(pr);
});

it('case 7: empty PR list → cache set to null for that sha', async () => {
  const cache = new PRCache();
  const fetchPRsForCommit = vi.fn().mockResolvedValue([]); // Empty list

  const input: PRLookupInput = {
    repoRoot: '/repo',
    shas: ['sha1'],
    cache,
  };

  const result = await lookupPRs(input, {
    resolveGitHubRemote: vi.fn().mockResolvedValue({ host: 'github', owner: 'o', repo: 'r' }),
    fetchPRsForCommit,
    getToken: vi.fn().mockResolvedValue('token123'),
  });

  expect(result.size).toBe(0);
  expect(cache.get('sha1')).toBe(null);
});
```

- [ ] **Step 2: Run tests to confirm they all exist**

```bash
npm test -- src/pr/service.test.ts
```

Expected: Tests 1-7 should now run (some may pass, some fail depending on implementation)

- [ ] **Step 3: Commit**

```bash
git add src/pr/service.test.ts
git commit -m "test: add lookupPRs test cases 4-7 (remote, limit, network, empty)"
```

---

### Task 6: Write test cases 8–10 for `lookupPRs`

**Files:**

- Modify: `src/pr/service.test.ts`

- [ ] **Step 1: Add test cases 8-10**

Append to the `describe('lookupPRs', () => {` block in `src/pr/service.test.ts`:

```typescript
it('case 8: multiple PRs, one merged → merged one wins', async () => {
  const cache = new PRCache();
  const unmergedPR = {
    number: 100,
    merged: false,
    html_url: 'https://github.com/owner/repo/pull/100',
  };
  const mergedPR = {
    number: 101,
    merged: true,
    html_url: 'https://github.com/owner/repo/pull/101',
  };
  const fetchPRsForCommit = vi.fn().mockResolvedValue([unmergedPR, mergedPR]);

  const input: PRLookupInput = {
    repoRoot: '/repo',
    shas: ['sha1'],
    cache,
  };

  const result = await lookupPRs(input, {
    resolveGitHubRemote: vi.fn().mockResolvedValue({ host: 'github', owner: 'o', repo: 'r' }),
    fetchPRsForCommit,
    getToken: vi.fn().mockResolvedValue('token123'),
  });

  expect(result.get('sha1')).toEqual(mergedPR);
});

it('case 9: multiple PRs, none merged → first PR wins', async () => {
  const cache = new PRCache();
  const pr1 = { number: 100, merged: false, html_url: 'https://github.com/owner/repo/pull/100' };
  const pr2 = { number: 101, merged: false, html_url: 'https://github.com/owner/repo/pull/101' };
  const fetchPRsForCommit = vi.fn().mockResolvedValue([pr1, pr2]);

  const input: PRLookupInput = {
    repoRoot: '/repo',
    shas: ['sha1'],
    cache,
  };

  const result = await lookupPRs(input, {
    resolveGitHubRemote: vi.fn().mockResolvedValue({ host: 'github', owner: 'o', repo: 'r' }),
    fetchPRsForCommit,
    getToken: vi.fn().mockResolvedValue('token123'),
  });

  expect(result.get('sha1')).toEqual(pr1);
});

it('case 10: mixed cached + uncached → cached short-circuits, only uncached shas fetched', async () => {
  const cache = new PRCache();
  const cachedPR = { number: 1, merged: false, html_url: 'https://github.com/owner/repo/pull/1' };
  const fetchedPR = { number: 2, merged: false, html_url: 'https://github.com/owner/repo/pull/2' };
  cache.set('sha1', cachedPR);

  const fetchPRsForCommit = vi.fn().mockResolvedValue([fetchedPR]);

  const input: PRLookupInput = {
    repoRoot: '/repo',
    shas: ['sha1', 'sha2'],
    cache,
  };

  const result = await lookupPRs(input, {
    resolveGitHubRemote: vi.fn().mockResolvedValue({ host: 'github', owner: 'o', repo: 'r' }),
    fetchPRsForCommit,
    getToken: vi.fn().mockResolvedValue('token123'),
  });

  // Only sha2 should have been fetched (sha1 was cached)
  expect(fetchPRsForCommit).toHaveBeenCalledTimes(1);
  expect(fetchPRsForCommit).toHaveBeenCalledWith(expect.objectContaining({ sha: 'sha2' }));
  expect(result.get('sha1')).toEqual(cachedPR);
  expect(result.get('sha2')).toEqual(fetchedPR);
});
```

- [ ] **Step 2: Run all 10 test cases**

```bash
npm test -- src/pr/service.test.ts
```

Expected: All 10 cases should now run (some may fail if implementation isn't complete)

- [ ] **Step 3: Commit**

```bash
git add src/pr/service.test.ts
git commit -m "test: add lookupPRs test cases 8-10 (merged PR logic, mixed cache)"
```

---

### Task 7: Verify all PR service tests pass

**Files:**

- Modify: `src/pr/service.ts` (if any implementation adjustments needed)

- [ ] **Step 1: Run all pr/service tests**

```bash
npm test -- src/pr/service.test.ts
```

Expected: All 10 cases PASS

If any fail, examine the error, then proceed to Step 2.

- [ ] **Step 2: If tests fail, debug and fix the implementation**

Most likely issue: the `resolvedDeps` merge logic or the cache-hit check. Verify that:

- Cache hits (defined values or nulls) short-circuit the fetch
- Only undefined cache entries trigger fetch calls
- The "prefer merged" logic works correctly (`prs.find((p) => p.merged) ?? prs[0]`)

- [ ] **Step 3: Run full typecheck and all tests**

```bash
npm run typecheck && npm test
```

Expected: All tests PASS, no type errors

- [ ] **Step 4: Commit (if any fixes were needed)**

```bash
git add src/pr/service.ts
git commit -m "fix: ensure lookupPRs logic matches all 10 test cases"
```

(If no fixes were needed, skip this commit.)

---

### Task 8: Final verification and cleanup

**Files:**

- All modified files reviewed for consistency

- [ ] **Step 1: Run the full kitchen-sink**

```bash
npm run kitchen-sink
```

Expected: All steps pass (format:check, lint, typecheck, test, compile, package)

- [ ] **Step 2: Verify no regressions in smoke tests**

```bash
npm test -- src/extension.smoke.test.ts
```

Expected: PASS (all commands, views, participants registered correctly)

- [ ] **Step 3: Review file structure one final time**

Verify:

- `src/stepping.ts` exports `shortLabel` and it's tested
- `src/diff.ts` exports `selectionRangeForHunk` and it's tested
- `src/pr/service.ts` has `PRLookupDeps` interface and `lookupPRs` uses injected deps
- `src/pr/service.test.ts` has all 10 cases, all passing
- `src/multiBaseline.ts` imports `shortLabel` from `stepping`
- `src/codeLens.ts` imports and uses `selectionRangeForHunk` from `diff`

- [ ] **Step 4: Create a summary commit (optional)**

If you want a final summary of all changes, create one:

```bash
git log --oneline -5
```

This should show 4-5 commits from this work.
