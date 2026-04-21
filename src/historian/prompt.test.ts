import { describe, expect, it } from 'vitest';
import type { BlameLine } from '../git/cli';
import { composeEvidence, recordToSummary } from './evidence';
import type { Evidence } from './evidence';
import type { CommitFileChange } from '../git/cli';
import {
	buildUserPrompt,
	compressRanges,
	formatSmartTimestamp,
	isCommitStory,
	systemPrompt,
} from './prompt';

const NOW = new Date('2026-04-19T12:00:00Z');

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
		expect(p).toContain('@historian');
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
		expect(buildUserPrompt(baseEv(), 'since', '')).toMatch(/since the given reference/i);
		expect(buildUserPrompt(baseEv(), 'author', '')).toMatch(/this author/i);
	});

	it('includes the user question when provided', () => {
		const prompt = buildUserPrompt(baseEv(), 'default', 'did we drop Node 18 support here?');
		expect(prompt).toContain('did we drop Node 18 support here?');
	});

	it('emits a "File:" scope line when no selection is present (commit-focused)', () => {
		const prompt = buildUserPrompt(baseEv({ relPath: 'src/foo.ts' }), 'default', '', NOW);
		expect(prompt).toContain('File: src/foo.ts');
		expect(prompt).not.toContain('```');
	});

	it('prefers the selection excerpt over the bare File: line when both are implied', () => {
		const prompt = buildUserPrompt(
			baseEv({
				relPath: 'src/foo.ts',
				selection: {
					relPath: 'src/foo.ts',
					startLine: 1,
					endLine: 1,
					excerpt: 'const x = 1;',
				},
			}),
			'default',
			'',
			NOW,
		);
		expect(prompt).toContain('lines 1–1');
		expect(prompt).not.toMatch(/^File: src\/foo\.ts$/m);
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

	it('blame bullets include author and timestamp; same-day collapses to HH:MM', () => {
		const ev = composeEvidence({
			fileRecords: [],
			blameLines: [
				{
					sha: 'a'.repeat(40),
					line: 1,
					author: 'Alice',
					authorEmail: 'alice@example.com',
					authorTime: Math.floor(new Date('2026-04-19T08:34:00Z').getTime() / 1000),
					summary: 'initial',
					content: '',
				},
			],
		});
		const prompt = buildUserPrompt(ev, 'default', '', NOW);
		expect(prompt).toContain('Alice');
		expect(prompt).toContain('08:34');
		expect(prompt).not.toContain('Apr');
	});

	it('same-day commit blocks show `HH:MM` only', () => {
		const fileCommits = [
			recordToSummary({
				...rec('a'.repeat(40), 'Did the thing'),
				authorDate: '2026-04-19T09:05:00Z',
			}),
		];
		const prompt = buildUserPrompt(baseEv({ fileCommits }), 'story', '', NOW);
		expect(prompt).toContain('`aaaaaaa` · Alice · 09:05 — Did the thing');
	});

	it('older commit blocks fall back to `Mon D, YYYY`', () => {
		const fileCommits = [
			recordToSummary({
				...rec('b'.repeat(40), 'Older work'),
				authorDate: '2025-11-03T09:05:00Z',
			}),
		];
		const prompt = buildUserPrompt(baseEv({ fileCommits }), 'story', '', NOW);
		expect(prompt).toContain('`bbbbbbb` · Alice · Nov 3, 2025 — Older work');
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
		const prompt = buildUserPrompt(baseEv({ filterDescription: 'since v1.0.0' }), 'since', '');
		expect(prompt).toContain('Filter: since v1.0.0');
	});
});

describe('formatSmartTimestamp', () => {
	it('collapses to `HH:MM` when the commit is on the same UTC day as now', () => {
		expect(formatSmartTimestamp(new Date('2026-04-19T08:34:00Z'), NOW)).toBe('08:34');
		expect(formatSmartTimestamp(new Date('2026-04-19T23:59:00Z'), NOW)).toBe('23:59');
	});

	it('falls back to `Mon D, YYYY` for earlier dates', () => {
		expect(formatSmartTimestamp(new Date('2026-04-18T23:59:00Z'), NOW)).toBe('Apr 18, 2026');
		expect(formatSmartTimestamp(new Date('2025-11-03T09:05:00Z'), NOW)).toBe('Nov 3, 2025');
	});

	it('falls back to `Mon D, YYYY` for later dates too (clock skew, future commits)', () => {
		expect(formatSmartTimestamp(new Date('2026-04-20T00:01:00Z'), NOW)).toBe('Apr 20, 2026');
	});

	it('uses the UTC calendar day, so 23:30 on "yesterday" renders as a date', () => {
		const now = new Date('2026-04-20T00:05:00Z');
		expect(formatSmartTimestamp(new Date('2026-04-19T23:30:00Z'), now)).toBe('Apr 19, 2026');
	});

	it('zero-pads single-digit hours and minutes', () => {
		expect(formatSmartTimestamp(new Date('2026-04-19T03:04:05Z'), NOW)).toBe('03:04');
	});
});

describe('isCommitStory', () => {
	it('is true only when /story names a specific commit', () => {
		const withRef = composeEvidence({
			fileRecords: [rec('a'.repeat(40), 's')],
			referencedShas: ['a'.repeat(40)],
		});
		const plain = composeEvidence({ fileRecords: [rec('a'.repeat(40), 's')] });
		expect(isCommitStory(withRef, 'story')).toBe(true);
		expect(isCommitStory(plain, 'story')).toBe(false);
		expect(isCommitStory(withRef, 'why')).toBe(false);
	});
});

describe('buildUserPrompt (commit-story mode)', () => {
	function file(path: string, add = 1, del = 0): CommitFileChange {
		return { path, additions: add, deletions: del, binary: false };
	}
	function binaryFile(path: string): CommitFileChange {
		return { path, additions: 0, deletions: 0, binary: true };
	}

	it('switches the task framing when /story references a commit', () => {
		const sha = 'a'.repeat(40);
		const evidence: Evidence = composeEvidence({
			fileRecords: [rec(sha, 'Refactor the auth flow')],
			referencedShas: [sha],
		});
		const out = buildUserPrompt(evidence, 'story', '', NOW);
		expect(out).toContain('Tell the story of the referenced commit');
		expect(out).not.toContain('narrative timeline of how this file');
		expect(out).toContain('Surrounding file history');
	});

	it('includes a "Files changed" section when commitFiles is populated', () => {
		const sha = 'a'.repeat(40);
		const evidence: Evidence = composeEvidence({
			fileRecords: [rec(sha, 'Refactor')],
			referencedShas: [sha],
			commitFiles: new Map([[sha, [file('src/a.ts', 4, 2), binaryFile('assets/logo.png')]]]),
		});
		const out = buildUserPrompt(evidence, 'story', '', NOW);
		expect(out).toContain('Files changed in `aaaaaaa`');
		expect(out).toContain('- src/a.ts · +4 -2');
		expect(out).toContain('- assets/logo.png (binary)');
	});

	it('caps very wide commits and notes the overflow', () => {
		const sha = 'a'.repeat(40);
		const files: CommitFileChange[] = Array.from({ length: 25 }, (_, i) =>
			file(`src/f${i}.ts`, 1, 1),
		);
		const evidence: Evidence = composeEvidence({
			fileRecords: [rec(sha, 'Big refactor')],
			referencedShas: [sha],
			commitFiles: new Map([[sha, files]]),
		});
		const out = buildUserPrompt(evidence, 'story', '', NOW);
		expect(out).toContain('- src/f0.ts');
		expect(out).toContain('- src/f19.ts');
		expect(out).not.toContain('- src/f20.ts');
		expect(out).toContain('…and 5 more files');
	});

	it('omits the files section when no commitFiles were gathered', () => {
		const sha = 'a'.repeat(40);
		const evidence: Evidence = composeEvidence({
			fileRecords: [rec(sha, 's')],
			referencedShas: [sha],
		});
		const out = buildUserPrompt(evidence, 'story', '', NOW);
		expect(out).not.toContain('Files changed in');
	});
});

describe('buildUserPrompt (commit diffs)', () => {
	it('renders a Diff excerpt block for each referenced commit', () => {
		const sha = 'a'.repeat(40);
		const evidence: Evidence = composeEvidence({
			fileRecords: [rec(sha, 'Refactor')],
			referencedShas: [sha],
			commitDiffs: new Map([[sha, '--- a/f\n+++ b/f\n@@ -1 +1 @@\n-old\n+new']]),
		});
		const out = buildUserPrompt(evidence, 'story', '', NOW);
		expect(out).toContain('Diff excerpt for `aaaaaaa`');
		expect(out).toContain('```diff');
		expect(out).toContain('+new');
	});

	it('emits diff blocks for blame-cited commits even without referenced commits', () => {
		// `/why` mode: no referencedShas, but we still pulled patches for top
		// blame SHAs. Should still surface in the prompt.
		const sha = 'b'.repeat(40);
		const evidence: Evidence = composeEvidence({
			fileRecords: [rec(sha, 'Touch')],
			commitDiffs: new Map([[sha, '--- a/f\n+++ b/f\n@@ -1 +1 @@\n+change']]),
		});
		const out = buildUserPrompt(evidence, 'why', '', NOW);
		expect(out).toContain('Diff excerpt for `bbbbbbb`');
		expect(out).toContain('+change');
	});

	it('skips the diffs section entirely when commitDiffs is empty', () => {
		const evidence: Evidence = composeEvidence({
			fileRecords: [rec('a'.repeat(40), 's')],
		});
		const out = buildUserPrompt(evidence, 'why', '', NOW);
		expect(out).not.toContain('Diff excerpt');
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
