import { describe, expect, it } from 'vitest';
import type { Hunk } from './diff';
import type { BlameLine } from './git/cli';
import { buildHoverMarkdown, hunksContainLine } from './hover';

const h = (newStart: number, newCount: number): Hunk => ({
	oldStart: 0,
	oldCount: 0,
	newStart,
	newCount,
});

describe('hunksContainLine', () => {
	it('returns false for an empty hunk list', () => {
		expect(hunksContainLine([], 5)).toBe(false);
	});

	it('includes the first and last line of a hunk (inclusive ranges)', () => {
		const hunks = [h(10, 3)];
		expect(hunksContainLine(hunks, 9)).toBe(false);
		expect(hunksContainLine(hunks, 10)).toBe(true);
		expect(hunksContainLine(hunks, 12)).toBe(true);
		expect(hunksContainLine(hunks, 13)).toBe(false);
	});

	it('ignores pure-delete hunks (newCount === 0)', () => {
		expect(hunksContainLine([h(5, 0)], 5)).toBe(false);
	});

	it('matches across multiple hunks', () => {
		const hunks = [h(1, 1), h(10, 2), h(20, 1)];
		expect(hunksContainLine(hunks, 1)).toBe(true);
		expect(hunksContainLine(hunks, 11)).toBe(true);
		expect(hunksContainLine(hunks, 20)).toBe(true);
		expect(hunksContainLine(hunks, 5)).toBe(false);
	});
});

function blame(overrides: Partial<BlameLine> = {}): BlameLine {
	return {
		sha: 'abc1234' + 'a'.repeat(33),
		line: 1,
		author: 'Alice',
		authorEmail: 'alice@example.com',
		authorTime: Math.floor(new Date('2026-04-19T12:00:00Z').getTime() / 1000),
		summary: 'Fix the thing',
		content: '',
		...overrides,
	};
}

describe('buildHoverMarkdown', () => {
	it('surfaces subject, short sha, author, email, and date', () => {
		const md = buildHoverMarkdown(blame());
		expect(md).toContain('**Fix the thing**');
		expect(md).toContain('`abc1234`');
		expect(md).toContain('Alice');
		expect(md).toContain('alice@example\\.com');
		expect(md).toContain('2026-04-19');
	});

	it('falls back to "(no subject)" when summary is empty', () => {
		expect(buildHoverMarkdown(blame({ summary: '' }))).toContain('no subject');
	});

	it('falls back to "unknown" when author is empty', () => {
		const md = buildHoverMarkdown(blame({ author: '' }));
		expect(md).toContain('unknown');
	});

	it('omits the email block when authorEmail is empty', () => {
		const md = buildHoverMarkdown(blame({ authorEmail: '' }));
		expect(md).not.toContain('<');
		expect(md).not.toContain('>');
	});

	it('escapes markdown control characters in author and summary', () => {
		const md = buildHoverMarkdown(
			blame({ summary: '[refactor] foo_bar', author: 'Alice (intern)' }),
		);
		expect(md).toContain('\\[refactor\\]');
		expect(md).toContain('foo\\_bar');
		expect(md).toContain('Alice \\(intern\\)');
	});
});
