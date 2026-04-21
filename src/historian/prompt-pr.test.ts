import { describe, expect, it } from 'vitest';
import { composeEvidence, type Evidence } from './evidence';
import { buildUserPrompt } from './prompt';
import type { PRSummary } from '../pr/github';

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

function pr(over: Partial<PRSummary> = {}): PRSummary {
	return {
		number: 42,
		title: 'Fix login',
		body: 'Restores the redirect flow.',
		url: 'https://github.com/o/r/pull/42',
		state: 'closed',
		merged: true,
		...over,
	};
}

describe('buildUserPrompt (PR context)', () => {
	it('renders a Pull requests section with title + body for each cited commit', () => {
		const sha = 'a'.repeat(40);
		const evidence: Evidence = composeEvidence({
			fileRecords: [rec(sha, 'Refactor auth')],
			referencedShas: [sha],
			commitPRs: new Map([[sha, pr({ number: 7, title: 'Fix login', body: 'Restores flow.' })]]),
		});
		const out = buildUserPrompt(evidence, 'story', '', NOW);
		expect(out).toContain('Pull requests:');
		expect(out).toContain('PR #7 (merged) for `aaaaaaa` — Fix login');
		expect(out).toContain('Restores flow.');
	});

	it('truncates PR bodies past the cap but keeps the header', () => {
		const sha = 'a'.repeat(40);
		const long = 'x'.repeat(3000);
		const evidence: Evidence = composeEvidence({
			fileRecords: [rec(sha, 's')],
			referencedShas: [sha],
			commitPRs: new Map([[sha, pr({ body: long })]]),
		});
		const out = buildUserPrompt(evidence, 'story', '', NOW);
		expect(out).toContain('…(truncated)');
		expect(out).toContain('PR #42');
	});

	it('uses "open" / "closed" state when the PR is not merged', () => {
		const sha = 'a'.repeat(40);
		const evidence: Evidence = composeEvidence({
			fileRecords: [rec(sha, 's')],
			referencedShas: [sha],
			commitPRs: new Map([[sha, pr({ merged: false, state: 'open' })]]),
		});
		const out = buildUserPrompt(evidence, 'story', '', NOW);
		expect(out).toContain('(open)');
	});

	it('omits the section entirely when no PRs were resolved', () => {
		const sha = 'a'.repeat(40);
		const evidence: Evidence = composeEvidence({
			fileRecords: [rec(sha, 's')],
		});
		const out = buildUserPrompt(evidence, 'why', '', NOW);
		expect(out).not.toContain('Pull requests');
	});
});
