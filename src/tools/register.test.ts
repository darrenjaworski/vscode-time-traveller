import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { registerTools } from './register';

vi.mock('../git/cli', () => ({
	logForPattern: vi.fn(),
	showCommitPatch: vi.fn(),
	showCommitMetadata: vi.fn(),
	showCommitStat: vi.fn(),
	blameRange: vi.fn(),
	logFile: vi.fn(),
	logFileSince: vi.fn(),
	logFileByAuthor: vi.fn(),
}));

describe('registerTools', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('registers all six language model tools', () => {
		const disposables = registerTools('/repo');
		const calls = vi.mocked(vscode.lm.registerTool).mock.calls.map(([name]) => name);
		expect(calls).toEqual(
			expect.arrayContaining([
				'timeTraveller_getCommitDetails',
				'timeTraveller_searchCommits',
				'timeTraveller_getCommitDiff',
				'timeTraveller_getBlame',
				'timeTraveller_findPRsForCommit',
				'timeTraveller_listFileHistory',
			]),
		);
		expect(disposables).toHaveLength(6);
	});

	it('wires getCommitDetails to real git CLI helpers (no empty stub)', async () => {
		const cli = await import('../git/cli');
		vi.mocked(cli.showCommitMetadata).mockResolvedValue({
			sha: 'a'.repeat(40),
			shortSha: 'aaaaaaa',
			authorName: 'Alice',
			authorEmail: 'a@example.com',
			authorDate: '2026-04-26T12:00:00Z',
			parents: '',
			subject: 'Real subject',
			body: 'Real body',
		});
		vi.mocked(cli.showCommitStat).mockResolvedValue([
			{ path: 'src/x.ts', additions: 3, deletions: 1, binary: false },
		]);

		registerTools('/repo');
		const detailsCall = vi
			.mocked(vscode.lm.registerTool)
			.mock.calls.find(([name]) => name === 'timeTraveller_getCommitDetails');
		expect(detailsCall).toBeDefined();
		const tool = detailsCall![1] as vscode.LanguageModelTool<{
			sha: string;
			includeFiles?: boolean;
		}>;

		const result = await tool.invoke(
			{
				input: { sha: 'a'.repeat(40), includeFiles: true },
				toolInvocationToken: {} as never,
			} as unknown as vscode.LanguageModelToolInvocationOptions<{
				sha: string;
				includeFiles?: boolean;
			}>,
			{} as never,
		);

		expect(result).toBeDefined();
		const text = (result!.content[0] as vscode.LanguageModelTextPart).value;
		expect(text).toContain('Real subject');
		expect(text).toContain('Real body');
		expect(text).toContain('Alice');
		expect(text).toContain('src/x.ts');
		expect(cli.showCommitMetadata).toHaveBeenCalledWith('/repo', 'a'.repeat(40));
		expect(cli.showCommitStat).toHaveBeenCalledWith('/repo', 'a'.repeat(40));
	});
});
