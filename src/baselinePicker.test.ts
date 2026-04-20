import { describe, expect, it } from 'vitest';
import {
	buildCommitSection,
	buildMergeBasePresets,
	buildPickItems,
	buildPresetItems,
	buildRefSection,
	buildScopesSection,
	buildStashSection,
	detectMergeBaseCandidates,
	sortRefsByName,
} from './baselinePicker';
import { RefType, type Ref } from './git/api';
import type { RawLogRecord, StashRecord } from './git/cli';

function ref(overrides: Partial<Ref>): Ref {
	return { type: RefType.Head, name: 'main', commit: '1'.repeat(40), ...overrides };
}

function commit(overrides: Partial<RawLogRecord> = {}): RawLogRecord {
	return {
		sha: 'a'.repeat(40),
		shortSha: 'aaaaaaa',
		authorName: 'Alice',
		authorEmail: 'alice@example.com',
		authorDate: '2026-04-19T12:00:00Z',
		parents: '',
		subject: 'Do the thing',
		body: '',
		...overrides,
	};
}

describe('buildPresetItems', () => {
	it('always offers HEAD and a custom-entry escape hatch', () => {
		const items = buildPresetItems(undefined);
		const labels = items.map((i) => i.label);
		expect(labels).toContain('$(git-commit) HEAD');
		expect(labels.some((l) => l.includes('Enter a git ref'))).toBe(true);
	});

	it('hides "Clear baseline" when there is no current ref', () => {
		const items = buildPresetItems(undefined);
		expect(items.some((i) => i.action === 'clear')).toBe(false);
	});

	it('shows "Clear baseline" when a current ref is set', () => {
		const items = buildPresetItems('v1.0.0');
		const clear = items.find((i) => i.action === 'clear');
		expect(clear).toBeDefined();
	});
});

describe('sortRefsByName', () => {
	it('returns a new array sorted alphabetically by name', () => {
		const input = [ref({ name: 'zeta' }), ref({ name: 'alpha' }), ref({ name: 'mu' })];
		const sorted = sortRefsByName(input);
		expect(sorted.map((r) => r.name)).toEqual(['alpha', 'mu', 'zeta']);
		// does not mutate
		expect(input.map((r) => r.name)).toEqual(['zeta', 'alpha', 'mu']);
	});
});

describe('buildRefSection', () => {
	it('returns nothing when no matching refs exist', () => {
		expect(buildRefSection('branch', [])).toEqual([]);
		expect(buildRefSection('tag', [ref({ type: RefType.Head })])).toEqual([]);
	});

	it('builds a separator + sorted branch rows', () => {
		const refs = [
			ref({ name: 'main', type: RefType.Head }),
			ref({ name: 'feature/x', type: RefType.Head }),
		];
		const items = buildRefSection('branch', refs);
		expect(items[0].label).toBe('Branches');
		expect(items.slice(1).map((i) => i.ref)).toEqual(['feature/x', 'main']);
	});

	it('uses cloud icon for remote branches and tag icon for tags', () => {
		const remotes = [ref({ name: 'origin/main', type: RefType.RemoteHead })];
		const tags = [ref({ name: 'v1', type: RefType.Tag })];
		expect(buildRefSection('remote', remotes)[1].label).toContain('$(cloud)');
		expect(buildRefSection('tag', tags)[1].label).toContain('$(tag)');
	});

	it('skips refs that have no name', () => {
		const refs = [ref({ name: undefined, type: RefType.Head })];
		expect(buildRefSection('branch', refs)).toEqual([]);
	});
});

describe('buildCommitSection', () => {
	it('returns nothing for zero commits', () => {
		expect(buildCommitSection([])).toEqual([]);
	});

	it('emits one item per commit with the full SHA as the ref', () => {
		const items = buildCommitSection([commit({ sha: 'f'.repeat(40), shortSha: 'fffffff' })]);
		expect(items[0].label).toBe('Recent commits');
		expect(items[1].ref).toBe('f'.repeat(40));
		expect(items[1].label).toBe('$(git-commit) fffffff');
	});
});

describe('detectMergeBaseCandidates', () => {
	it('returns locally-named default branches first', () => {
		const refs = [
			ref({ name: 'main', type: RefType.Head }),
			ref({ name: 'origin/main', type: RefType.RemoteHead }),
		];
		expect(detectMergeBaseCandidates(refs, 'feature/x')).toEqual(['main']);
	});

	it('falls back to origin/<name> when no local matches', () => {
		const refs = [ref({ name: 'origin/master', type: RefType.RemoteHead })];
		expect(detectMergeBaseCandidates(refs, 'feature/x')).toEqual(['origin/master']);
	});

	it('excludes the current branch', () => {
		const refs = [
			ref({ name: 'main', type: RefType.Head }),
			ref({ name: 'develop', type: RefType.Head }),
		];
		expect(detectMergeBaseCandidates(refs, 'main')).toEqual(['develop']);
	});

	it('returns [] when no default-branch candidates exist', () => {
		expect(detectMergeBaseCandidates([], 'feature/x')).toEqual([]);
	});
});

describe('buildMergeBasePresets', () => {
	it('returns [] for no candidates', () => {
		expect(buildMergeBasePresets([])).toEqual([]);
	});

	it('builds a Scopes separator + one row per candidate', () => {
		const items = buildMergeBasePresets(['main', 'origin/develop']);
		expect(items[0].label).toBe('Scopes');
		expect(items[1].mergeBaseTarget).toBe('main');
		expect(items[1].action).toBe('merge-base');
		expect(items[2].mergeBaseTarget).toBe('origin/develop');
	});
});

describe('buildScopesSection', () => {
	it('returns [] when neither a release tag nor merge-base candidates exist', () => {
		expect(buildScopesSection({ mergeBaseCandidates: [] })).toEqual([]);
	});

	it('lists the latest release tag before merge-base candidates', () => {
		const items = buildScopesSection({
			mergeBaseCandidates: ['main'],
			latestReleaseTagName: 'v1.2.0',
		});
		expect(items[0].label).toBe('Scopes');
		expect(items[1].label).toContain('Last release (v1.2.0)');
		expect(items[1].ref).toBe('v1.2.0');
		expect(items[2].mergeBaseTarget).toBe('main');
	});

	it('can emit only a release-tag row when there are no merge-base candidates', () => {
		const items = buildScopesSection({
			mergeBaseCandidates: [],
			latestReleaseTagName: 'v2.0.0',
		});
		expect(items).toHaveLength(2);
		expect(items[1].ref).toBe('v2.0.0');
	});
});

describe('buildStashSection', () => {
	const stash = (overrides: Partial<StashRecord> = {}): StashRecord => ({
		name: 'stash@{0}',
		subject: 'WIP on main: abc',
		...overrides,
	});

	it('returns [] for no stashes', () => {
		expect(buildStashSection([])).toEqual([]);
	});

	it('emits a Stashes separator + one row per stash, preserving order', () => {
		const items = buildStashSection([
			stash({ name: 'stash@{0}', subject: 'WIP A' }),
			stash({ name: 'stash@{1}', subject: 'WIP B' }),
		]);
		expect(items[0].label).toBe('Stashes');
		expect(items.slice(1).map((i) => i.ref)).toEqual(['stash@{0}', 'stash@{1}']);
		expect(items[1].label).toContain('$(archive)');
	});
});

describe('buildPickItems', () => {
	it('composes presets + scopes + branches + tags + remotes + stashes + commits', () => {
		const items = buildPickItems({
			currentRef: 'v1.0.0',
			refs: [
				ref({ name: 'main', type: RefType.Head }),
				ref({ name: 'v1.0.0', type: RefType.Tag }),
				ref({ name: 'origin/main', type: RefType.RemoteHead }),
			],
			recentCommits: [commit()],
			mergeBaseCandidates: ['main'],
			latestReleaseTagName: 'v1.0.0',
			stashes: [{ name: 'stash@{0}', subject: 'WIP' }],
		});
		const separators = items.filter((i) => i.kind === -1).map((i) => i.label);
		expect(separators).toEqual([
			'Presets',
			'Scopes',
			'Branches',
			'Tags',
			'Remote branches',
			'Stashes',
			'Recent commits',
		]);
	});

	it('omits sections that have no data', () => {
		const items = buildPickItems({
			currentRef: undefined,
			refs: [],
			recentCommits: [],
			mergeBaseCandidates: [],
		});
		const separators = items.filter((i) => i.kind === -1).map((i) => i.label);
		expect(separators).toEqual(['Presets']);
	});
});
