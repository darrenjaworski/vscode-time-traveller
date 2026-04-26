import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { SearchCommitsTool } from './searchCommits';

describe('SearchCommitsTool', () => {
	it('returns formatted list of commits matching pattern', async () => {
		const tool = new SearchCommitsTool({
			repoRoot: '/repo',
			logForPattern: vi.fn().mockResolvedValue([
				{
					sha: 'abc123def456abc123def456abc123def456abc1',
					shortSha: 'abc123d',
					subject: 'fix: memory leak in cache',
					authorName: 'Alice',
					authorDate: '2026-01-15T10:30:00Z',
				},
				{
					sha: 'def456abc123def456abc123def456abc123def45',
					shortSha: 'def456a',
					subject: 'fix: off-by-one error',
					authorName: 'Bob',
					authorDate: '2026-01-14T14:20:00Z',
				},
			]),
		});
		const result = await tool.invoke({
			input: { pattern: 'fix', limit: 5 },
			toolInvocationToken: {} as unknown,
		} as unknown as vscode.LanguageModelToolInvocationOptions<{
			pattern: string;
			limit?: number;
		}>);

		const text = (result.content[0] as vscode.LanguageModelTextPart).value;
		expect(text).toContain('abc123d');
		expect(text).toContain('fix: memory leak in cache');
		expect(text).toContain('def456a');
		expect(text).toContain('fix: off-by-one error');
		expect(text).toContain('Alice');
		expect(text).toContain('Bob');
	});

	it('uses default limit when not provided', async () => {
		const mockLogForPattern = vi.fn().mockResolvedValue([
			{
				sha: 'a'.repeat(40),
				shortSha: 'aaaaaaa',
				subject: 'test',
				authorName: 'Test',
				authorDate: '2026-01-01T00:00:00Z',
			},
		]);

		const tool = new SearchCommitsTool({
			repoRoot: '/repo',
			logForPattern: mockLogForPattern,
		});

		await tool.invoke({
			input: { pattern: 'test' },
			toolInvocationToken: {} as unknown,
		} as unknown as vscode.LanguageModelToolInvocationOptions<{
			pattern: string;
			limit?: number;
		}>);

		expect(mockLogForPattern).toHaveBeenCalledWith('/repo', 'test', 10);
	});
});
