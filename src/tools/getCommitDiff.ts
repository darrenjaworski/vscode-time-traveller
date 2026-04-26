import * as vscode from 'vscode';
import type { TrimmedPatch } from '../historian/diff';

export interface GetCommitDiffInput {
	sha: string;
	relPath?: string;
	maxChars?: number;
}

export interface GetCommitDiffDeps {
	repoRoot: string;
	showCommitPatch: (repoRoot: string, sha: string, relPath?: string) => Promise<string>;
	trimPatch: (patch: string, options?: { maxChars?: number }) => TrimmedPatch;
}

export class GetCommitDiffTool implements vscode.LanguageModelTool<GetCommitDiffInput> {
	constructor(private readonly deps: GetCommitDiffDeps) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<GetCommitDiffInput>,
	): Promise<vscode.LanguageModelToolResult> {
		const maxChars = options.input.maxChars ?? 5000;
		const patch = await this.deps.showCommitPatch(
			this.deps.repoRoot,
			options.input.sha,
			options.input.relPath,
		);

		const trimmed = this.deps.trimPatch(patch, { maxChars });
		const output = trimmed.text
			? trimmed.text + (trimmed.truncated ? `\n\n(... ${trimmed.omittedLines} lines omitted)` : '')
			: '(no changes)';

		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(output)]);
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<GetCommitDiffInput>,
	): Promise<vscode.PreparedToolInvocation> {
		const label = options.input.relPath ? `file ${options.input.relPath}` : 'commit';
		return {
			invocationMessage: `Reading diff for ${label} at ${options.input.sha.slice(0, 7)}…`,
		};
	}
}
