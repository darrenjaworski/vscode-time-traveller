import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { GetCommitDiffTool } from './getCommitDiff';

describe('GetCommitDiffTool', () => {
	it('returns trimmed diff for a commit', async () => {
		const mockPatch = `--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 const x = 1;
+const y = 2;
 export { x };
`;

		const tool = new GetCommitDiffTool({
			repoRoot: '/repo',
			showCommitPatch: vi.fn().mockResolvedValue(mockPatch),
			trimPatch: vi.fn().mockReturnValue({
				text: '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,3 +1,4 @@\n const x = 1;\n+const y = 2;',
				truncated: false,
				omittedLines: 0,
			}),
		});

		const result = await tool.invoke({
			input: { sha: 'abc123', relPath: 'src/foo.ts', maxChars: 1000 },
			toolInvocationToken: {} as unknown,
		} as unknown as vscode.LanguageModelToolInvocationOptions<{
			sha: string;
			relPath?: string;
			maxChars?: number;
		}>);

		const text = (result.content[0] as vscode.LanguageModelTextPart).value;
		expect(text).toContain('const x = 1');
		expect(text).toContain('const y = 2');
	});

	it('uses default maxChars when not provided', async () => {
		const mockTrimPatch = vi.fn().mockReturnValue({
			text: 'diff content',
			truncated: false,
			omittedLines: 0,
		});

		const tool = new GetCommitDiffTool({
			repoRoot: '/repo',
			showCommitPatch: vi.fn().mockResolvedValue('patch'),
			trimPatch: mockTrimPatch,
		});

		await tool.invoke({
			input: { sha: 'abc123' },
			toolInvocationToken: {} as unknown,
		} as unknown as vscode.LanguageModelToolInvocationOptions<{
			sha: string;
			relPath?: string;
			maxChars?: number;
		}>);

		expect(mockTrimPatch).toHaveBeenCalledWith('patch', { maxChars: 5000 });
	});
});
