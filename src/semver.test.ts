import { describe, expect, it } from 'vitest';
import { compareSemver, latestReleaseTag, parseSemverTag } from './semver';

describe('parseSemverTag', () => {
	it('accepts `v`-prefixed tags', () => {
		expect(parseSemverTag('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
	});

	it('accepts bare numeric tags', () => {
		expect(parseSemverTag('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
	});

	it('captures the prerelease suffix via `-`', () => {
		expect(parseSemverTag('v1.0.0-rc.1')).toEqual({
			major: 1,
			minor: 0,
			patch: 0,
			prerelease: 'rc.1',
		});
	});

	it('rejects non-semver shapes', () => {
		expect(parseSemverTag('release-2026-04')).toBeUndefined();
		expect(parseSemverTag('v1.2')).toBeUndefined();
		expect(parseSemverTag('')).toBeUndefined();
	});

	it('rejects leading zeros? actually accepts — git allows them', () => {
		expect(parseSemverTag('v01.02.03')).toEqual({ major: 1, minor: 2, patch: 3 });
	});
});

describe('compareSemver', () => {
	const v = (s: string) => parseSemverTag(s)!;

	it('compares major · minor · patch numerically, not lexically', () => {
		expect(compareSemver(v('v1.10.0'), v('v1.2.0'))).toBeGreaterThan(0);
		expect(compareSemver(v('v2.0.0'), v('v1.99.99'))).toBeGreaterThan(0);
	});

	it('stable release beats prerelease of the same version', () => {
		expect(compareSemver(v('v1.0.0'), v('v1.0.0-rc.1'))).toBeGreaterThan(0);
	});

	it('orders prereleases alphabetically as a rough approximation', () => {
		expect(compareSemver(v('v1.0.0-rc.2'), v('v1.0.0-rc.1'))).toBeGreaterThan(0);
		expect(compareSemver(v('v1.0.0-alpha'), v('v1.0.0-beta'))).toBeLessThan(0);
	});
});

describe('latestReleaseTag', () => {
	it('picks the numerically-greatest stable tag', () => {
		expect(latestReleaseTag(['v1.2.0', 'v1.10.0', 'v1.9.0'])).toBe('v1.10.0');
	});

	it('ignores prereleases', () => {
		expect(latestReleaseTag(['v1.0.0', 'v2.0.0-rc.1'])).toBe('v1.0.0');
	});

	it('ignores non-semver tag names', () => {
		expect(latestReleaseTag(['release-2025', 'nightly', 'v0.3.4'])).toBe('v0.3.4');
	});

	it('returns undefined when no stable semver tag is present', () => {
		expect(latestReleaseTag(['release-2025', 'v0.1.0-rc.1'])).toBeUndefined();
		expect(latestReleaseTag([])).toBeUndefined();
	});

	it('preserves the original tag name (v-prefix intact)', () => {
		expect(latestReleaseTag(['v1.0.0', '0.9.0'])).toBe('v1.0.0');
	});
});
