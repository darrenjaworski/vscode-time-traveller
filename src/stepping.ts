/**
 * Pure navigation over a file's linear log. `entries` is expected to be in
 * reverse-chronological order (as `git log` returns it): `entries[0]` is the
 * newest, `entries[N-1]` is the oldest. `back` walks toward older commits,
 * `forward` walks toward newer ones.
 *
 * If the current SHA isn't in the list (e.g. baseline is `HEAD`, a branch
 * name, or something not touching this file), "back" jumps to the newest
 * commit that does touch the file; "forward" is a no-op.
 */
export type StepDirection = 'back' | 'forward';

/**
 * Shortens a 40-character SHA to its first 8 characters (short form).
 * Non-SHA refs (branches, tags, etc.) are returned unchanged.
 */
export function shortLabel(ref: string): string {
	return /^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 8) : ref;
}

export function computeStep<T extends { sha: string }>(
	entries: readonly T[],
	currentSha: string | undefined,
	direction: StepDirection,
): T | undefined {
	if (entries.length === 0) return undefined;
	if (!currentSha) {
		return direction === 'back' ? entries[0] : undefined;
	}
	const idx = entries.findIndex((e) => e.sha === currentSha);
	if (idx === -1) {
		return direction === 'back' ? entries[0] : undefined;
	}
	const newIdx = direction === 'back' ? idx + 1 : idx - 1;
	if (newIdx < 0 || newIdx >= entries.length) return undefined;
	return entries[newIdx];
}
