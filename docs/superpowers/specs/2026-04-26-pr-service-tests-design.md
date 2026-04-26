# Design: Coverage for `pr/service.ts` + cheap test wins

**Date:** 2026-04-26
**Status:** Approved (pending implementation plan)

## Goal

Close the largest test-coverage gap in the codebase (`src/pr/service.ts`) and pick up a few cheap pure-helper extractions in adjacent untested modules. The work follows the project's existing convention (per `CLAUDE.md`): pure logic first, mocked boundaries second.

## Scope

In scope:

- Refactor `src/pr/service.ts` to inject the boundaries `lookupPRs` depends on, then test the orchestration logic directly.
- Extract `shortLabel` from `src/multiBaseline.ts` to `src/stepping.ts` (the existing home of pure stepping helpers) and test it.
- Extract the hunk→selection-range math from `src/codeLens.ts` into a pure helper in `src/diff.ts` and test it alongside the existing diff helpers.

Out of scope:

- `src/history/view.ts` and `src/git/api.ts` — predominantly vscode glue, low ROI for the effort required.
- Any change to `chat.ts` (or other callers of `lookupPRs`) — default deps preserve current behavior so callers stay untouched.
- New abstractions in `pr/service.ts` beyond the dependency object.
- New contribution points (so `extension.smoke.test.ts` is unaffected).

## Architecture change: `src/pr/service.ts`

Today, `lookupPRs` imports `fetchPRsForCommit` directly and calls `resolveGitHubRemote` / `getGitHubToken` as private module functions. That forces tests to mock `node-fetch`-equivalents and `vscode.authentication`, which is the wrong layer.

After the refactor, `lookupPRs` is a pure orchestrator over an injected `deps` object. The defaults preserve the existing wiring exactly.

```ts
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

export async function lookupPRs(
  input: PRLookupInput,
  deps?: Partial<PRLookupDeps>,
): Promise<Map<string, PRSummary>>;
```

The existing private `resolveGitHubRemote` and `getGitHubToken` become the defaults. The existing `fetchPRsForCommit` import becomes the default for `deps.fetchPRsForCommit`. Production callers — `src/chat.ts` and any other site — pass no second argument and see no behavior change.

`PRCache` is already pure and unit-tested; tests reuse it directly rather than mocking it.

## Tests: `src/pr/service.test.ts` (new)

One case per regression-prone branch:

1. Empty `shas` → empty map, zero calls to any dep.
2. All cache hits returning `PRSummary` → returned in the map; no fetch calls.
3. All cache hits returning `null` → empty map; no fetch calls.
4. Non-GitHub remote (`resolveGitHubRemote` returns `undefined`) → no fetches; cache populated with `null` for every uncached sha.
5. `limit` cap — N shas all uncached, `limit: 2` → only first 2 fetched; remaining shas neither fetched nor cached.
6. Network failure — `fetchPRsForCommit` returns `undefined` → cache untouched for that sha (retry next time); other shas in the same batch still processed.
7. Empty PR list — `fetchPRsForCommit` returns `[]` → cache set to `null` for that sha.
8. Multiple PRs, one merged → the merged PR wins.
9. Multiple PRs, none merged → first PR wins.
10. Mixed cached + uncached input → cached shas short-circuit; only uncached shas trigger fetches.

All deps are `vi.fn()` so call counts and arguments can be asserted alongside return values.

## Secondary changes

### `src/multiBaseline.ts` → `src/stepping.ts`

Move `shortLabel(ref)` to `stepping.ts` and export it. The function is pure (40-hex-char check → slice; otherwise pass-through) and belongs with the other pure stepping helpers per the project's convention. `multiBaseline.ts` imports it.

Tests in `src/stepping.test.ts`:

- Full 40-char lowercase SHA → first 8 chars.
- Full 40-char mixed-case SHA → first 8 chars (case-insensitive regex).
- Short SHA (e.g. 7 chars) → returned unchanged.
- Branch name (`main`, `feature/x`) → returned unchanged.
- Tag-like (`v1.2.3`) → returned unchanged.

### `src/codeLens.ts` → `src/diff.ts`

Extract the hunk→selection-range math currently inline inside the `askHistorianForHunk` command callback:

```ts
export function selectionRangeForHunk(hunk: Hunk): { startLine: number; endLine: number };
```

`startLine` reuses `codeLensLineForHunk(hunk)`. `endLine` is `Math.max(startLine, startLine + Math.max(hunk.newCount, 1) - 1)`. The command callback in `codeLens.ts` calls the helper and constructs the `vscode.Selection` from the result.

Tests added to `src/diff.test.ts`:

- Hunk with `newCount: 0` (pure deletion) → `endLine === startLine`.
- Hunk with `newCount: 1` → `endLine === startLine`.
- Hunk with `newCount: 5` → `endLine === startLine + 4`.
- Hunk where `codeLensLineForHunk` returns line 0 → range stays valid (no negative lines).

The rest of `codeLens.ts` (provider class, command registration, config-change handling) stays untested — it's vscode-glue with low ROI.

## Risk and verification

- **Behavior preservation in `lookupPRs`:** the only structural change is a `deps` parameter with defaults equal to today's wiring. The existing imports remain at module top-level for the defaults, so the production code path is byte-equivalent.
- **`chat.ts` and other callers:** unchanged. They will continue to call `lookupPRs(input)` with one argument.
- **Run the full kitchen-sink (`npm run kitchen-sink`) before declaring done.** New tests must pass and no existing test should regress.

## Definition of done

- `src/pr/service.test.ts` exists with the 10 cases above, all passing.
- `shortLabel` lives in `src/stepping.ts` with tests; `multiBaseline.ts` re-imports it; behavior unchanged.
- `selectionRangeForHunk` lives in `src/diff.ts` with tests; `codeLens.ts`'s command callback uses it; behavior unchanged.
- `npm run kitchen-sink` passes.
- No changes to `package.json` contribution points and no smoke-test edits.
