import { describe, it, expect, vi } from 'vitest';
import { getBlame } from './getBlame';

describe('getBlame', () => {
	it('returns formatted blame lines for a range', async () => {
		const mockBlame = [
			{
				sha: 'abc123def456abc123def456abc123def456abc1',
				line: 10,
				author: 'Alice',
				authorEmail: 'alice@example.com',
				authorTime: 1610000000,
				summary: 'feat: add new feature',
				content: 'const x = 1;',
			},
			{
				sha: 'def456abc123def456abc123def456abc123def45',
				line: 11,
				author: 'Bob',
				authorEmail: 'bob@example.com',
				authorTime: 1620000000,
				summary: 'refactor: improve code',
				content: 'const y = 2;',
			},
			{
				sha: 'abc123def456abc123def456abc123def456abc1',
				line: 12,
				author: 'Alice',
				authorEmail: 'alice@example.com',
				authorTime: 1610000000,
				summary: 'feat: add new feature',
				content: 'console.log(x, y);',
			},
		];

		const mockBlameRange = vi.fn().mockResolvedValue(mockBlame);

		const result = await getBlame(
			{ relPath: 'src/app.ts', startLine: 10, endLine: 12 },
			{ repoRoot: '/repo', blameRange: mockBlameRange },
		);

		expect(result).toContain('line 10:');
		expect(result).toContain('abc123d');
		expect(result).toContain('Alice');
		expect(result).toContain('feat: add new feature');

		expect(result).toContain('line 11:');
		expect(result).toContain('def456a');
		expect(result).toContain('Bob');
		expect(result).toContain('refactor: improve code');

		expect(result).toContain('line 12:');
	});

	it('formats dates correctly', async () => {
		const mockBlame = [
			{
				sha: 'a'.repeat(40),
				line: 1,
				author: 'Test',
				authorEmail: 'test@example.com',
				authorTime: 1704067200, // 2024-01-01 00:00:00 UTC
				summary: 'test',
				content: 'test line',
			},
		];

		const mockBlameRange = vi.fn().mockResolvedValue(mockBlame);

		const result = await getBlame(
			{ relPath: 'src/test.ts', startLine: 1, endLine: 1 },
			{ repoRoot: '/repo', blameRange: mockBlameRange },
		);

		// Should contain date (formatted by toLocaleDateString, which varies by timezone)
		expect(result).toContain('aaaaaaa');
		expect(result).toContain('Test');
		expect(result).toContain('test');
		expect(result).toMatch(/\d+\/\d+\/202\d/); // Date in M/D/YYYY format
	});
});
