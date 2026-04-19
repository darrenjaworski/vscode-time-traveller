import { describe, expect, it } from 'vitest';
import { composeEvidence, recordToSummary, type Evidence } from './evidence';
import { suggestFollowups } from './followups';

const rec = (sha: string, subject = 'commit') => ({
	sha,
	shortSha: sha.slice(0, 7),
	authorName: 'Alice',
	authorEmail: 'alice@example.com',
	authorDate: '2026-04-19T12:00:00Z',
	parents: '',
	subject,
	body: '',
});

const blame = (sha: string, line: number, author: string) => ({
	sha,
	line,
	author,
	authorEmail: `${author}@example.com`,
	authorTime: 0,
	summary: 'summary',
	content: '',
});

describe('suggestFollowups', () => {
	it('offers /story when the user asked something else', () => {
		const ev = composeEvidence({ fileRecords: [rec('a'.repeat(40))] });
		const followups = suggestFollowups('default', ev);
		expect(followups.some((f) => f.command === 'story')).toBe(true);
	});

	it('does not suggest the current command as a follow-up', () => {
		const ev = composeEvidence({ fileRecords: [rec('a'.repeat(40))] });
		expect(suggestFollowups('story', ev).some((f) => f.command === 'story')).toBe(false);
	});

	it('offers a drill-down into the most recent commit on the file', () => {
		const ev = composeEvidence({ fileRecords: [rec('abc1234' + 'a'.repeat(33), 'Fix thing')] });
		const followups = suggestFollowups('default', ev);
		expect(followups.some((f) => f.prompt.includes('abc1234'))).toBe(true);
	});

	it('offers a "compare to previous" for referenced commits when distinct from the tip', () => {
		const fileCommits = [recordToSummary(rec('a'.repeat(40), 'tip'))];
		const referenced = [recordToSummary(rec('b'.repeat(40), 'referenced'))];
		const ev: Evidence = { fileCommits, referencedCommits: referenced };
		const followups = suggestFollowups('default', ev);
		expect(followups.some((f) => f.label.includes('bbbbbbb'))).toBe(true);
	});

	it('offers "/author <name>" when blame surfaces a recognizable author', () => {
		const ev: Evidence = {
			fileCommits: [],
			referencedCommits: [],
			blameLines: [blame('a'.repeat(40), 1, 'Bob')],
		};
		const followups = suggestFollowups('default', ev);
		const authorFollowup = followups.find((f) => f.command === 'author');
		expect(authorFollowup?.prompt).toBe('Bob');
	});

	it('caps the list at 4 suggestions', () => {
		const ev: Evidence = {
			fileCommits: [recordToSummary(rec('a'.repeat(40), 'tip'))],
			referencedCommits: [recordToSummary(rec('b'.repeat(40), 'referenced'))],
			blameLines: [blame('c'.repeat(40), 1, 'Carol')],
		};
		expect(suggestFollowups('default', ev).length).toBeLessThanOrEqual(4);
	});
});
