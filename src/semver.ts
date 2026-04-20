/**
 * Minimal semver parsing + comparison, scoped to what the baseline picker
 * needs: pick the "latest release" tag from a repo's tag list.
 *
 * Not a full semver implementation — we don't need build metadata, and the
 * prerelease comparison is a rough alphabetic approximation rather than the
 * full identifier-by-identifier precedence rules from the spec. Adequate for
 * "which of these tags is the most recent stable release".
 */

export interface SemverTag {
	major: number;
	minor: number;
	patch: number;
	prerelease?: string;
}

export function parseSemverTag(name: string): SemverTag | undefined {
	const match = name.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
	if (!match) return undefined;
	return {
		major: Number.parseInt(match[1], 10),
		minor: Number.parseInt(match[2], 10),
		patch: Number.parseInt(match[3], 10),
		prerelease: match[4],
	};
}

export function compareSemver(a: SemverTag, b: SemverTag): number {
	if (a.major !== b.major) return a.major - b.major;
	if (a.minor !== b.minor) return a.minor - b.minor;
	if (a.patch !== b.patch) return a.patch - b.patch;
	// Stable > prerelease of same version.
	if (!a.prerelease && b.prerelease) return 1;
	if (a.prerelease && !b.prerelease) return -1;
	if (!a.prerelease && !b.prerelease) return 0;
	// Both prereleases — alphabetic approximation is good enough for picking
	// a "latest" display target.
	return (a.prerelease ?? '').localeCompare(b.prerelease ?? '');
}

/**
 * Pick the newest *stable* (non-prerelease) semver tag from a list, preserving
 * the original name so the `v` prefix (if any) stays intact when we echo it.
 * Returns undefined when no stable semver tag is present.
 */
export function latestReleaseTag(tagNames: string[]): string | undefined {
	let best: { name: string; parsed: SemverTag } | undefined;
	for (const name of tagNames) {
		const parsed = parseSemverTag(name);
		if (!parsed || parsed.prerelease) continue;
		if (!best || compareSemver(parsed, best.parsed) > 0) {
			best = { name, parsed };
		}
	}
	return best?.name;
}
