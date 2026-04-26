import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { GetCommitDetailsTool } from './getCommitDetails';

describe('GetCommitDetailsTool', () => {
	it('returns formatted output for a known commit', async () => {
		const tool = new GetCommitDetailsTool({
			repoRoot: '/repo',
			gitShow: vi.fn().mockResolvedValue({
				sha: 'a'.repeat(40),
				subject: 'Fix bug',
				body: 'Detail',
				authorName: 'Alice',
				authorDate: new Date('2026-01-01'),
				files: [{ path: 'src/x.ts', additions: 3, deletions: 1, binary: false }],
			}),
		});
		const result = await tool.invoke({
			input: { sha: 'aaaa', includeFiles: true },
			toolInvocationToken: {} as unknown,
		} as unknown as vscode.LanguageModelToolInvocationOptions<{
			sha: string;
			includeFiles?: boolean;
		}>);
		const text = (result.content[0] as vscode.LanguageModelTextPart).value;
		expect(text).toContain('Fix bug');
		expect(text).toContain('src/x.ts');
	});
});
