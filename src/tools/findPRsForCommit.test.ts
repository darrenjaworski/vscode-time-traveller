import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { FindPRsForCommitTool } from './findPRsForCommit';
import type { PRSummary } from '../pr/github';

describe('FindPRsForCommitTool', () => {
	it('returns formatted PR info when PRs are found', async () => {
		const mockPRSummary: PRSummary = {
			number: 123,
			title: 'Add cool feature',
			body: 'This adds a cool feature',
			url: 'https://github.com/org/repo/pull/123',
			state: 'closed',
			merged: true,
		};

		const tool = new FindPRsForCommitTool({
			repoRoot: '/repo',
			lookupPRs: vi.fn().mockResolvedValue(new Map([['abc123', mockPRSummary]])),
		});

		const result = await tool.invoke({
			input: { sha: 'abc123' },
			toolInvocationToken: {} as unknown,
		} as unknown as vscode.LanguageModelToolInvocationOptions<{ sha: string }>);

		const text = (result.content[0] as vscode.LanguageModelTextPart).value;
		expect(text).toContain('PR #123');
		expect(text).toContain('merged');
		expect(text).toContain('Add cool feature');
		expect(text).toContain('github.com');
	});

	it('returns "No PRs found" when no PRs exist', async () => {
		const tool = new FindPRsForCommitTool({
			repoRoot: '/repo',
			lookupPRs: vi.fn().mockResolvedValue(new Map()),
		});

		const result = await tool.invoke({
			input: { sha: 'abc123' },
			toolInvocationToken: {} as unknown,
		} as unknown as vscode.LanguageModelToolInvocationOptions<{ sha: string }>);

		const text = (result.content[0] as vscode.LanguageModelTextPart).value;
		expect(text).toContain('No PRs found');
	});

	it('calls lookupPRs with correct parameters', async () => {
		const mockLookupPRs = vi.fn().mockResolvedValue(new Map());

		const tool = new FindPRsForCommitTool({
			repoRoot: '/repo',
			lookupPRs: mockLookupPRs,
		});

		await tool.invoke({
			input: { sha: 'abc123' },
			toolInvocationToken: {} as unknown,
		} as unknown as vscode.LanguageModelToolInvocationOptions<{ sha: string }>);

		expect(mockLookupPRs).toHaveBeenCalledWith(
			expect.objectContaining({
				repoRoot: '/repo',
				shas: ['abc123'],
			}),
		);
	});
});
