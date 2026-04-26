import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { ListFileHistoryTool } from './listFileHistory';

describe('ListFileHistoryTool', () => {
	it('returns formatted list of commits for a file', async () => {
		const mockRecords = [
			{
				sha: 'abc123def456abc123def456abc123def456abc1',
				shortSha: 'abc123d',
				subject: 'feat: add logging',
				authorName: 'Alice',
				authorEmail: 'alice@example.com',
				authorDate: '2026-01-15T10:30:00Z',
				body: 'Detail',
				parents: 'xyz',
			},
			{
				sha: 'def456abc123def456abc123def456abc123def45',
				shortSha: 'def456a',
				subject: 'refactor: improve readability',
				authorName: 'Bob',
				authorEmail: 'bob@example.com',
				authorDate: '2026-01-14T14:20:00Z',
				body: 'Detail',
				parents: 'xyz',
			},
		];

		const tool = new ListFileHistoryTool({
			repoRoot: '/repo',
			logFile: vi.fn().mockResolvedValue(mockRecords),
		});

		const result = await tool.invoke({
			input: { relPath: 'src/app.ts' },
			toolInvocationToken: {} as unknown,
		} as unknown as vscode.LanguageModelToolInvocationOptions<{
			relPath: string;
			since?: string;
			author?: string;
			limit?: number;
		}>);

		const text = (result.content[0] as vscode.LanguageModelTextPart).value;
		expect(text).toContain('abc123d');
		expect(text).toContain('feat: add logging');
		expect(text).toContain('Alice');
		expect(text).toContain('def456a');
		expect(text).toContain('refactor: improve readability');
		expect(text).toContain('Bob');
	});

	it('uses default limit when not provided', async () => {
		const mockLogFile = vi.fn().mockResolvedValue([
			{
				sha: 'a'.repeat(40),
				shortSha: 'aaaaaaa',
				subject: 'test',
				authorName: 'Test',
				authorEmail: 'test@example.com',
				authorDate: '2026-01-01T00:00:00Z',
				body: '',
				parents: 'xyz',
			},
		]);

		const tool = new ListFileHistoryTool({
			repoRoot: '/repo',
			logFile: mockLogFile,
		});

		await tool.invoke({
			input: { relPath: 'src/test.ts' },
			toolInvocationToken: {} as unknown,
		} as unknown as vscode.LanguageModelToolInvocationOptions<{
			relPath: string;
			since?: string;
			author?: string;
			limit?: number;
		}>);

		expect(mockLogFile).toHaveBeenCalledWith('/repo', 'src/test.ts', 20);
	});

	it('uses custom limit when provided', async () => {
		const mockLogFile = vi.fn().mockResolvedValue([]);

		const tool = new ListFileHistoryTool({
			repoRoot: '/repo',
			logFile: mockLogFile,
		});

		await tool.invoke({
			input: { relPath: 'src/test.ts', limit: 50 },
			toolInvocationToken: {} as unknown,
		} as unknown as vscode.LanguageModelToolInvocationOptions<{
			relPath: string;
			since?: string;
			author?: string;
			limit?: number;
		}>);

		expect(mockLogFile).toHaveBeenCalledWith('/repo', 'src/test.ts', 50);
	});
});
