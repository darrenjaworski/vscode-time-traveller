/**
 * Pure parser for the hunk headers in unified git-diff output. Given the
 * stdout from `git diff --unified=0 <ref> -- <file>`, emit one `Hunk` per
 * `@@ -oldStart[,oldCount] +newStart[,newCount] @@` line.
 *
 * `newStart` / `newCount` are what the CodeLens provider cares about — they
 * describe the hunk's range *in the current file*, i.e. what the editor is
 * showing the user right now.
 */

export interface Hunk {
	oldStart: number;
	oldCount: number;
	newStart: number;
	newCount: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseDiffHunks(diffOutput: string): Hunk[] {
	const out: Hunk[] = [];
	for (const line of diffOutput.split('\n')) {
		const m = line.match(HUNK_HEADER);
		if (!m) continue;
		out.push({
			oldStart: Number.parseInt(m[1], 10),
			oldCount: m[2] !== undefined ? Number.parseInt(m[2], 10) : 1,
			newStart: Number.parseInt(m[3], 10),
			newCount: m[4] !== undefined ? Number.parseInt(m[4], 10) : 1,
		});
	}
	return out;
}

/**
 * Zero-based line where we should attach the CodeLens for a hunk. For
 * pure-deletions (`newCount === 0`) git reports `newStart` as the line the
 * deletion happened *after*, so the lens sits on that line. For modifications
 * or additions, `newStart` is the first new line (1-based), which becomes
 * `newStart - 1` in VS Code's 0-based coordinate system. Clamps to 0 so we
 * don't return negative positions on malformed input.
 */
export function codeLensLineForHunk(hunk: Hunk): number {
	return Math.max(0, hunk.newStart - 1);
}
