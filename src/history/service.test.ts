import { describe, expect, it } from 'vitest';
import type { RawLogRecord } from '../git/cli';
import { toHistoryEntry } from './service';

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
