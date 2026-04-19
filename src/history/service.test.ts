import { describe, expect, it } from 'vitest';
import type { RawLogRecord } from '../git/cli';
import { applyRenames, toHistoryEntry, type HistoryEntry } from './service';

function baseRecord(overrides: Partial<RawLogRecord> = {}): RawLogRecord {
	return {
		sha: 'a'.repeat(40),
		shortSha: 'aaaaaaa',
		authorName: 'Alice',
		authorEmail: 'alice@example.com',
		authorDate: '2026-04-19T12:00:00Z',
		parents: `${'b'.repeat(40)}`,
		subject: 'Do the thing',
		body: 'Body text',
		...overrides,
	};
}

describe('toHistoryEntry', () => {
	it('maps scalar fields through untouched', () => {
		const entry = toHistoryEntry(baseRecord());
		expect(entry).toMatchObject({
			sha: 'a'.repeat(40),
			shortSha: 'aaaaaaa',
			authorName: 'Alice',
			authorEmail: 'alice@example.com',
			subject: 'Do the thing',
			body: 'Body text',
		});
	});

	it('parses the ISO author date into a Date object', () => {
		const entry = toHistoryEntry(baseRecord({ authorDate: '2026-01-02T03:04:05Z' }));
		expect(entry.authorDate).toBeInstanceOf(Date);
		expect(entry.authorDate.toISOString()).toBe('2026-01-02T03:04:05.000Z');
	});

	it('splits parents on whitespace and filters empties', () => {
		const entry = toHistoryEntry(baseRecord({ parents: `${'b'.repeat(40)} ${'c'.repeat(40)}` }));
		expect(entry.parents).toEqual(['b'.repeat(40), 'c'.repeat(40)]);
	});

	it('treats zero or one parents as a non-merge', () => {
		expect(toHistoryEntry(baseRecord({ parents: '' })).isMerge).toBe(false);
		expect(toHistoryEntry(baseRecord({ parents: 'b'.repeat(40) })).isMerge).toBe(false);
	});

	it('flags two-or-more-parent commits as merges', () => {
		const entry = toHistoryEntry(baseRecord({ parents: `${'b'.repeat(40)} ${'c'.repeat(40)}` }));
		expect(entry.isMerge).toBe(true);
	});
});

function entry(sha: string, overrides: Partial<HistoryEntry> = {}): HistoryEntry {
	return {
		sha,
		shortSha: sha.slice(0, 7),
		subject: 's',
		body: '',
		authorName: 'A',
		authorEmail: 'a@a',
		authorDate: new Date('2026-01-01T00:00:00Z'),
		parents: [],
		isMerge: false,
		...overrides,
	};
}

describe('applyRenames', () => {
	it('annotates the newer entry when adjacent paths differ', () => {
		const entries = [entry('a1'), entry('b2'), entry('c3')];
		const paths = new Map([
			['a1', 'src/new.ts'],
			['b2', 'src/old.ts'],
			['c3', 'src/old.ts'],
		]);
		applyRenames(entries, paths);
		expect(entries[0].renamedFrom).toBe('src/old.ts');
		expect(entries[1].renamedFrom).toBeUndefined();
		expect(entries[2].renamedFrom).toBeUndefined();
	});

	it('supports multiple renames in a single chain', () => {
		const entries = [entry('a1'), entry('b2'), entry('c3')];
		const paths = new Map([
			['a1', 'v3.ts'],
			['b2', 'v2.ts'],
			['c3', 'v1.ts'],
		]);
		applyRenames(entries, paths);
		expect(entries[0].renamedFrom).toBe('v2.ts');
		expect(entries[1].renamedFrom).toBe('v1.ts');
	});

	it('skips entries missing from the map', () => {
		const entries = [entry('a1'), entry('b2')];
		const paths = new Map([['a1', 'src/foo.ts']]);
		applyRenames(entries, paths);
		expect(entries[0].renamedFrom).toBeUndefined();
	});

	it('is a no-op when paths are identical across the log', () => {
		const entries = [entry('a1'), entry('b2')];
		const paths = new Map([
			['a1', 'src/foo.ts'],
			['b2', 'src/foo.ts'],
		]);
		applyRenames(entries, paths);
		expect(entries[0].renamedFrom).toBeUndefined();
	});
});
