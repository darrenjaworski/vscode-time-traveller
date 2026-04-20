import { describe, expect, it } from 'vitest';
import { codeLensLineForHunk, parseDiffHunks, type Hunk } from './diff';

const DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index abc1234..def5678 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -5,0 +6,2 @@ existing context
+new line 1
+new line 2
@@ -10,1 +12,1 @@ other
-removed
+added
@@ -20,3 +21,0 @@ pure delete
-gone
-also gone
-and this too
`;

describe('parseDiffHunks', () => {
	it('returns [] for empty input', () => {
		expect(parseDiffHunks('')).toEqual([]);
	});

	it('parses one Hunk per @@ header', () => {
		expect(parseDiffHunks(DIFF)).toEqual([
			{ oldStart: 5, oldCount: 0, newStart: 6, newCount: 2 },
			{ oldStart: 10, oldCount: 1, newStart: 12, newCount: 1 },
			{ oldStart: 20, oldCount: 3, newStart: 21, newCount: 0 },
		]);
	});

	it('defaults omitted counts to 1', () => {
		const diff = '@@ -3 +7 @@';
		expect(parseDiffHunks(diff)).toEqual([{ oldStart: 3, oldCount: 1, newStart: 7, newCount: 1 }]);
	});

	it('ignores non-header lines without throwing', () => {
		const diff = 'garbage\n@@ -1 +1 @@\nmore garbage\n';
		expect(parseDiffHunks(diff)).toHaveLength(1);
	});
});

describe('codeLensLineForHunk', () => {
	const h = (newStart: number, newCount: number): Hunk => ({
		oldStart: 0,
		oldCount: 0,
		newStart,
		newCount,
	});

	it('maps 1-based newStart to 0-based editor line', () => {
		expect(codeLensLineForHunk(h(1, 1))).toBe(0);
		expect(codeLensLineForHunk(h(10, 3))).toBe(9);
	});

	it('clamps to 0 for a pure-delete at the top of the file', () => {
		expect(codeLensLineForHunk(h(0, 0))).toBe(0);
	});
});
