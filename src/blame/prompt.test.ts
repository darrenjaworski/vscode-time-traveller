import { describe, expect, it } from 'vitest';
import type { BlameLine } from '../git/cli';
import { composeEvidence, recordToSummary } from './evidence';
import type { Evidence } from './evidence';
import { buildUserPrompt, compressRanges, systemPrompt } from './prompt';

function rec(sha: string, subject: string) {
	return {
		sha,
		shortSha: sha.slice(0, 7),
		authorName: 'Alice',
		authorEmail: 'alice@example.com',
		authorDate: '2026-04-19T12:00:00Z',
		parents: '',
		subject,
		body: '',
	};
}

function blame(sha: string, line: number, summary: string): BlameLine {
	return {
		sha,
		line,
		author: 'Alice',
		authorEmail: 'alice@example.com',
		authorTime: 0,
		summary,
		content: '',
	};
}

describe('systemPrompt', () => {
	it('tells the model to ground claims in evidence and not invent history', () => {
		const p = systemPrompt();
		expect(p).toContain('never invent');
		expect(p).toContain('@blame');
	});
});

describe('buildUserPrompt', () => {
	const baseEv = (overrides: Partial<Evidence> = {}): Evidence => ({
		fileCommits: [],
		referencedCommits: [],
		...overrides,
	});

	it('uses a /why task description by default', () => {
		const prompt = buildUserPrompt(baseEv(), 'default', '');
		expect(prompt).toMatch(/selected lines/i);
	});

	it('switches the task description per slash command', () => {
		expect(buildUserPrompt(baseEv(), 'story', '')).toMatch(/narrative timeline/i);
		expect(buildUserPrompt(baseEv(), 'blame-since', '')).toMatch(/since the given reference/i);
		expect(buildUserPrompt(baseEv(), 'author', '')).toMatch(/this author/i);
	});

	it('includes the user question when provided', () => {
		const prompt = buildUserPrompt(baseEv(), 'default', 'did we drop Node 18 support here?');
		expect(prompt).toContain('did we drop Node 18 support here?');
	});

	it('emits the selection excerpt inside a fenced block', () => {
		const prompt = buildUserPrompt(
			baseEv({
				selection: {
					relPath: 'src/foo.ts',
					startLine: 10,
					endLine: 12,
					excerpt: 'const x = 1;\nconst y = 2;',
				},
			}),
			'default',
			'',
		);
		expect(prompt).toContain('src/foo.ts');
		expect(prompt).toContain('lines 10–12');
		expect(prompt).toContain('```');
		expect(prompt).toContain('const x = 1;');
	});

	it('surfaces referenced commits ahead of the general file log', () => {
		const referenced = [recordToSummary(rec('b'.repeat(40), 'explicit commit'))];
		const fileCommits = [
			recordToSummary(rec('a'.repeat(40), 'older')),
			recordToSummary(rec('b'.repeat(40), 'explicit commit')),
		];
		const prompt = buildUserPrompt(
			baseEv({ referencedCommits: referenced, fileCommits }),
			'default',
			'',
		);
		const refIdx = prompt.indexOf('Commits the user explicitly asked about');
		const logIdx = prompt.indexOf('Recent file history');
		expect(refIdx).toBeGreaterThan(-1);
		expect(logIdx).toBeGreaterThan(refIdx);
	});

	it('groups blame by SHA with compressed line ranges', () => {
		const ev = composeEvidence({
			fileRecords: [],
			blameLines: [
				blame('a'.repeat(40), 1, 'initial'),
				blame('a'.repeat(40), 2, 'initial'),
				blame('a'.repeat(40), 4, 'initial'),
				blame('b'.repeat(40), 3, 'fix edge case'),
			],
		});
		const prompt = buildUserPrompt(ev, 'default', '');
		expect(prompt).toContain('Blame for the selected lines');
		expect(prompt).toMatch(/aaaaaaa.*initial.*1-2, 4/);
		expect(prompt).toMatch(/bbbbbbb.*fix edge case.*3/);
	});

	it('caps the file log so prompts do not blow out the context window', () => {
		const fileCommits = Array.from({ length: 30 }, (_, i) =>
			recordToSummary(rec(String(i).padStart(40, '0'), `subject ${i}`)),
		);
		const prompt = buildUserPrompt(baseEv({ fileCommits }), 'story', '');
		const bulletCount = prompt.split('\n').filter((l) => l.startsWith('`')).length;
		expect(bulletCount).toBeLessThanOrEqual(12);
	});

	it('surfaces a filter description when provided', () => {
		const prompt = buildUserPrompt(
			baseEv({ filterDescription: 'since v1.0.0' }),
			'blame-since',
			'',
		);
		expect(prompt).toContain('Filter: since v1.0.0');
	});
});

describe('compressRanges', () => {
	it('returns an empty string for no numbers', () => {
		expect(compressRanges([])).toBe('');
	});

	it('keeps standalone numbers', () => {
		expect(compressRanges([3])).toBe('3');
		expect(compressRanges([3, 5, 9])).toBe('3, 5, 9');
	});

	it('collapses contiguous runs', () => {
		expect(compressRanges([1, 2, 3])).toBe('1-3');
		expect(compressRanges([1, 2, 3, 5, 6, 9])).toBe('1-3, 5-6, 9');
	});

	it('sorts input before compressing', () => {
		expect(compressRanges([3, 1, 2])).toBe('1-3');
	});
});
