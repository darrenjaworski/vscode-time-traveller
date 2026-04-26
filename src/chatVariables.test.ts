import { describe, it, expect } from 'vitest';
import { formatBaselineValue, formatHistoryValue, formatCommitValue } from './chatVariables';

describe('formatBaselineValue', () => {
	it('emits the ref when set', () => {
		expect(formatBaselineValue('main')).toBe('Current diff baseline: `main`');
	});
	it('emits "no baseline" when undefined', () => {
		expect(formatBaselineValue(undefined)).toBe('No diff baseline set (defaults to HEAD)');
	});
});

describe('formatHistoryValue', () => {
	it('formats a list of commits', () => {
		const out = formatHistoryValue('src/foo.ts', [
			{
				shortSha: 'aaa1234',
				subject: 'first',
				authorName: 'Alice',
				authorDate: new Date('2026-01-01'),
			},
		]);
		expect(out).toContain('src/foo.ts');
		expect(out).toContain('aaa1234');
		expect(out).toContain('Alice');
		expect(out).toContain('first');
	});
	it('handles empty history', () => {
		expect(formatHistoryValue('src/foo.ts', [])).toContain('No commits');
	});
});

describe('formatCommitValue', () => {
	it('formats a commit when provided', () => {
		const out = formatCommitValue({
			shortSha: 'abc1234',
			subject: 'fix',
			authorName: 'A',
			authorDate: new Date('2026-01-01'),
			body: 'detail',
		});
		expect(out).toContain('abc1234');
		expect(out).toContain('fix');
		expect(out).toContain('detail');
	});
	it('returns "no selection" when undefined', () => {
		expect(formatCommitValue(undefined)).toBe('No commit selected in the History panel');
	});
});
