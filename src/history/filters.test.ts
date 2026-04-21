import { describe, expect, it } from 'vitest';
import {
	dateBucketLabel,
	describeFilters,
	filterEntries,
	groupEntries,
	hasActiveFilters,
} from './filters';
import type { HistoryEntry } from './service';

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
	return {
		sha: 'a'.repeat(40),
		shortSha: 'aaaaaaa',
		subject: 'Do the thing',
		body: 'Longer explanation',
		authorName: 'Alice',
		authorEmail: 'alice@example.com',
		authorDate: new Date('2026-04-19T12:00:00Z'),
		parents: ['b'.repeat(40)],
		isMerge: false,
		...overrides,
	};
}

describe('hasActiveFilters', () => {
	it('is false for empty filters', () => {
		expect(hasActiveFilters({})).toBe(false);
	});

	it('ignores whitespace-only text', () => {
		expect(hasActiveFilters({ text: '   ' })).toBe(false);
	});

	it('detects text and hideMerges', () => {
		expect(hasActiveFilters({ text: 'foo' })).toBe(true);
		expect(hasActiveFilters({ hideMerges: true })).toBe(true);
	});
});

describe('filterEntries', () => {
	it('passes everything through when filters are empty', () => {
		const es = [entry({ sha: '1' }), entry({ sha: '2', isMerge: true })];
		expect(filterEntries(es, {})).toEqual(es);
	});

	it('drops merges when hideMerges is set', () => {
		const es = [entry({ sha: '1' }), entry({ sha: '2', isMerge: true })];
		expect(filterEntries(es, { hideMerges: true })).toHaveLength(1);
		expect(filterEntries(es, { hideMerges: true })[0].sha).toBe('1');
	});

	it('matches text against subject case-insensitively', () => {
		const es = [entry({ subject: 'Fix LOGIN bug' }), entry({ subject: 'Refactor cache' })];
		expect(filterEntries(es, { text: 'login' })).toHaveLength(1);
	});

	it('matches text against body too', () => {
		const es = [entry({ subject: 'x', body: 'touches auth flow' })];
		expect(filterEntries(es, { text: 'auth' })).toHaveLength(1);
	});

	it('treats whitespace-only text as no filter', () => {
		const es = [entry({ subject: 'x' })];
		expect(filterEntries(es, { text: '   ' })).toEqual(es);
	});

	it('combines hideMerges and text (AND semantics)', () => {
		const es = [
			entry({ sha: '1', subject: 'fix login', isMerge: false }),
			entry({ sha: '2', subject: 'merge login branch', isMerge: true }),
		];
		const out = filterEntries(es, { text: 'login', hideMerges: true });
		expect(out.map((e) => e.sha)).toEqual(['1']);
	});
});

describe('groupEntries', () => {
	it('returns a single synthetic group for grouping=none', () => {
		const es = [entry({ sha: '1' }), entry({ sha: '2' })];
		const out = groupEntries(es, 'none');
		expect(out).toHaveLength(1);
		expect(out[0].entries).toHaveLength(2);
	});

	it('returns [] for empty input', () => {
		expect(groupEntries([], 'date')).toEqual([]);
		expect(groupEntries([], 'none')).toEqual([]);
	});

	it('buckets by author preserving first-seen order', () => {
		const es = [
			entry({ sha: '1', authorName: 'Alice' }),
			entry({ sha: '2', authorName: 'Bob' }),
			entry({ sha: '3', authorName: 'Alice' }),
		];
		const out = groupEntries(es, 'author');
		expect(out.map((g) => g.label)).toEqual(['Alice', 'Bob']);
		expect(out[0].entries.map((e) => e.sha)).toEqual(['1', '3']);
		expect(out[1].entries.map((e) => e.sha)).toEqual(['2']);
	});

	it('falls back to author email when name is empty', () => {
		const es = [entry({ authorName: '', authorEmail: 'x@y' })];
		expect(groupEntries(es, 'author')[0].label).toBe('x@y');
	});

	it('buckets by date relative to now', () => {
		// Local-time dates; `dateBucketLabel` normalizes against local midnight.
		const now = new Date(2026, 3, 22, 12, 0, 0);
		const es = [
			entry({ sha: '1', authorDate: new Date(2026, 3, 22, 9, 0, 0) }), // today
			entry({ sha: '2', authorDate: new Date(2026, 3, 21, 9, 0, 0) }), // yesterday
			entry({ sha: '3', authorDate: new Date(2026, 3, 18, 9, 0, 0) }), // this week
			entry({ sha: '4', authorDate: new Date(2026, 3, 1, 9, 0, 0) }), // this month
			entry({ sha: '5', authorDate: new Date(2025, 10, 1, 9, 0, 0) }), // this year
			entry({ sha: '6', authorDate: new Date(2020, 0, 1, 9, 0, 0) }), // older
		];
		const out = groupEntries(es, 'date', now);
		expect(out.map((g) => g.label)).toEqual([
			'Today',
			'Yesterday',
			'This week',
			'This month',
			'This year',
			'Older',
		]);
	});
});

describe('dateBucketLabel', () => {
	// Local-time dates so the test doesn't flake across timezones; `startOfDay`
	// strips local wall-clock components.
	const now = new Date(2026, 3, 22, 12, 0, 0);
	it('labels same calendar day as Today', () => {
		expect(dateBucketLabel(new Date(2026, 3, 22, 0, 0, 1), now)).toBe('Today');
	});
	it('labels previous calendar day as Yesterday', () => {
		expect(dateBucketLabel(new Date(2026, 3, 21, 23, 59, 0), now)).toBe('Yesterday');
	});
	it('labels 2-6 days ago as This week', () => {
		expect(dateBucketLabel(new Date(2026, 3, 17, 0, 0, 0), now)).toBe('This week');
	});
	it('labels under a year as This year', () => {
		expect(dateBucketLabel(new Date(2025, 11, 1, 0, 0, 0), now)).toBe('This year');
	});
});

describe('describeFilters', () => {
	it('returns empty when nothing is active', () => {
		expect(describeFilters({}, 'none')).toBe('');
	});

	it('concatenates active filters with middots', () => {
		expect(describeFilters({ text: 'fix', hideMerges: true }, 'date')).toBe(
			'"fix" · no merges · by date',
		);
	});
});
