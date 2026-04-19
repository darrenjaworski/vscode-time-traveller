import { describe, expect, it } from 'vitest';
import {
	buildCommitSection,
	buildPickItems,
	buildPresetItems,
	buildRefSection,
	sortRefsByName,
} from './baselinePicker';
import { RefType, type Ref } from './git/api';
import type { RawLogRecord } from './git/cli';

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

describe('buildPickItems', () => {
	it('composes presets + branches + tags + remotes + commits', () => {
		const items = buildPickItems({
			currentRef: 'v1.0.0',
			refs: [
				ref({ name: 'main', type: RefType.Head }),
				ref({ name: 'v1.0.0', type: RefType.Tag }),
				ref({ name: 'origin/main', type: RefType.RemoteHead }),
			],
			recentCommits: [commit()],
		});
		const separators = items.filter((i) => i.kind === -1).map((i) => i.label);
		expect(separators).toEqual([
			'Presets',
			'Branches',
			'Tags',
			'Remote branches',
			'Recent commits',
		]);
	});

	it('omits sections that have no data', () => {
		const items = buildPickItems({
			currentRef: undefined,
			refs: [],
			recentCommits: [],
		});
		const separators = items.filter((i) => i.kind === -1).map((i) => i.label);
		expect(separators).toEqual(['Presets']);
	});
});
