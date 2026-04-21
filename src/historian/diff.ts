/**
 * Pure helpers for shaping `git show` patch output into something the prompt
 * can consume without blowing a token budget. Kept free of `vscode` so the
 * trimming rules stay testable.
 */

export interface TrimmedPatch {
	/** The (possibly truncated) patch text, ready to drop into a code block. */
	text: string;
	/** Number of raw input lines that were dropped from the tail. */
	omittedLines: number;
	/** True when the input was truncated. */
	truncated: boolean;
}

export interface TrimOptions {
	/** Hard cap on characters in the returned patch. Default 4000. */
	maxChars?: number;
	/** Hard cap on lines in the returned patch. Default 200. */
	maxLines?: number;
}

/**
 * Trim a patch to fit in a prompt. Drops the `diff --git` / `index` banner
 * lines (the file header is already carried in the "Files changed" section)
 * and then caps on whichever of `maxChars` / `maxLines` fires first. Always
 * ends on a newline so the enclosing code block looks clean.
 */
export function trimPatch(patch: string, options: TrimOptions = {}): TrimmedPatch {
	const maxChars = options.maxChars ?? 4000;
	const maxLines = options.maxLines ?? 200;
	const cleaned = stripDiffBanners(patch);
	const allLines = cleaned.split('\n');
	const kept: string[] = [];
	let chars = 0;
	let used = 0;
	for (const line of allLines) {
		const cost = line.length + 1; // +1 for the newline
		if (used >= maxLines || chars + cost > maxChars) break;
		kept.push(line);
		chars += cost;
		used += 1;
	}
	const omittedLines = Math.max(0, allLines.length - kept.length);
	// Don't leave a trailing blank from the original split.
	while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop();
	return {
		text: kept.join('\n'),
		omittedLines,
		truncated: omittedLines > 0,
	};
}

/**
 * Drop the `diff --git …`, `index …`, `similarity index …`, `rename from …`,
 * `rename to …`, and `new file mode …` / `deleted file mode …` banners. The
 * `---` / `+++` header lines are kept because they pin which file each hunk
 * belongs to inside a multi-file diff.
 */
export function stripDiffBanners(patch: string): string {
	const out: string[] = [];
	for (const line of patch.split('\n')) {
		if (
			line.startsWith('diff --git') ||
			line.startsWith('index ') ||
			line.startsWith('similarity index ') ||
			line.startsWith('rename from ') ||
			line.startsWith('rename to ') ||
			line.startsWith('new file mode ') ||
			line.startsWith('deleted file mode ') ||
			line.startsWith('old mode ') ||
			line.startsWith('new mode ')
		) {
			continue;
		}
		out.push(line);
	}
	return out.join('\n');
}
