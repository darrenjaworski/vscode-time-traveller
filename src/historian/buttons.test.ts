import { describe, it, expect } from 'vitest';
import { suggestActionButtons } from './buttons';
import type { Evidence } from './evidence';

const baseEv = (overrides: Partial<Evidence> = {}): Evidence => ({
	fileCommits: [],
	referencedCommits: [],
	...overrides,
});

describe('suggestActionButtons', () => {
	it('emits set-baseline + open-diff when a referenced commit is present', () => {
		const ev = baseEv({
			referencedCommits: [
				{
					sha: 'a'.repeat(40),
					shortSha: 'aaaaaaa',
					subject: 's',
					body: '',
					authorName: 'A',
					authorEmail: 'a@a',
					authorDate: new Date(),
					isMerge: false,
				},
			],
		});
		const buttons = suggestActionButtons(ev);
		expect(buttons.map((b) => b.command)).toContain('timeTraveller.history.setBaseline');
		expect(buttons.map((b) => b.command)).toContain('timeTraveller.openDiffWithBaseline');
		expect(buttons.length).toBeLessThanOrEqual(3);
	});

	it('falls back to top blame SHA when no referenced commit', () => {
		const ev = baseEv({
			blameLines: [
				{
					sha: 'b'.repeat(40),
					summary: 's',
					author: 'a',
					authorEmail: 'a@a',
					authorTime: 0,
					line: 1,
					content: 'line',
				},
				{
					sha: 'b'.repeat(40),
					summary: 's',
					author: 'a',
					authorEmail: 'a@a',
					authorTime: 0,
					line: 2,
					content: 'line',
				},
				{
					sha: 'c'.repeat(40),
					summary: 's',
					author: 'a',
					authorEmail: 'a@a',
					authorTime: 0,
					line: 3,
					content: 'line',
				},
			],
		});
		const buttons = suggestActionButtons(ev);
		expect(buttons[0].arguments[0]).toBe('b'.repeat(40));
	});

	it('returns empty array when no commit can be cited', () => {
		expect(suggestActionButtons(baseEv())).toEqual([]);
	});
});
