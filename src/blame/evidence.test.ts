import { describe, expect, it } from 'vitest';
import type { RawLogRecord } from '../git/cli';
import {
	citedShas,
	composeEvidence,
	extractShaMention,
	recordToSummary,
	type Evidence,
} from './evidence';

function rec(sha: string, overrides: Partial<RawLogRecord> = {}): RawLogRecord {
	return {
		sha,
		shortSha: sha.slice(0, 7),
		authorName: 'Alice',
		authorEmail: 'alice@example.com',
		authorDate: '2026-04-19T12:00:00Z',
		parents: '',
		subject: `commit ${sha.slice(0, 7)}`,
		body: '',
		...overrides,
	};
}

describe('extractShaMention', () => {
	it('picks up a short SHA from a prompt', () => {
		expect(extractShaMention('why did commit abc1234 change foo.ts?')).toBe('abc1234');
	});

	it('picks up a full SHA', () => {
		const sha = 'a'.repeat(40);
		expect(extractShaMention(`explain ${sha}`)).toBe(sha);
	});

	it('returns undefined when no SHA-shaped token is present', () => {
		expect(extractShaMention('what changed here?')).toBeUndefined();
	});

	it('ignores decimal-only words (they are not hex)', () => {
		expect(extractShaMention('line 123456 changed')).toBeUndefined();
	});
});

describe('recordToSummary', () => {
	it('maps scalar fields and parses the date', () => {
		const s = recordToSummary(rec('a'.repeat(40), { subject: 'hi' }));
		expect(s.subject).toBe('hi');
		expect(s.authorDate).toBeInstanceOf(Date);
		expect(s.isMerge).toBe(false);
	});

	it('marks multi-parent commits as merges', () => {
		const s = recordToSummary(
			rec('a'.repeat(40), { parents: `${'b'.repeat(40)} ${'c'.repeat(40)}` }),
		);
		expect(s.isMerge).toBe(true);
	});
});

describe('composeEvidence', () => {
	it('maps file records to summaries preserving order', () => {
		const records = [rec('a'.repeat(40)), rec('b'.repeat(40)), rec('c'.repeat(40))];
		const ev = composeEvidence({ fileRecords: records });
		expect(ev.fileCommits.map((c) => c.shortSha)).toEqual(['aaaaaaa', 'bbbbbbb', 'ccccccc']);
		expect(ev.referencedCommits).toEqual([]);
	});

	it('promotes referenced SHAs (full or short) to referencedCommits', () => {
		const records = [rec('a'.repeat(40)), rec('b'.repeat(40))];
		const ev = composeEvidence({ fileRecords: records, referencedShas: ['bbbbbbb'] });
		expect(ev.referencedCommits).toHaveLength(1);
		expect(ev.referencedCommits[0].sha).toBe('b'.repeat(40));
	});

	it('matches referenced prefixes against full SHAs', () => {
		const records = [rec('abc1234567890' + 'a'.repeat(27))];
		const ev = composeEvidence({ fileRecords: records, referencedShas: ['abc1234'] });
		expect(ev.referencedCommits).toHaveLength(1);
	});

	it('carries selection and filterDescription through untouched', () => {
		const ev = composeEvidence({
			fileRecords: [],
			selection: { relPath: 'a.ts', startLine: 1, endLine: 3, excerpt: '' },
			filterDescription: 'since v1.0.0',
		});
		expect(ev.selection?.startLine).toBe(1);
		expect(ev.filterDescription).toBe('since v1.0.0');
	});
});

describe('citedShas', () => {
	const evidence = (overrides: Partial<Evidence> = {}): Evidence => ({
		fileCommits: [],
		referencedCommits: [],
		...overrides,
	});

	it('emits referenced commits first, then file commits, deduplicated', () => {
		const ev = evidence({
			referencedCommits: [recordToSummary(rec('b'.repeat(40)))],
			fileCommits: [recordToSummary(rec('a'.repeat(40))), recordToSummary(rec('b'.repeat(40)))],
		});
		expect(citedShas(ev)).toEqual(['b'.repeat(40), 'a'.repeat(40)]);
	});

	it('honors the maxCount cap', () => {
		const ev = evidence({
			fileCommits: Array.from({ length: 20 }, (_, i) =>
				recordToSummary(rec(String(i).padStart(40, '0'))),
			),
		});
		expect(citedShas(ev, 5)).toHaveLength(5);
	});
});
