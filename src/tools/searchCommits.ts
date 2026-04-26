import * as vscode from 'vscode';
import type { RawLogRecord } from '../git/cli';

export interface SearchCommitsInput {
	pattern: string;
	limit?: number;
}

export interface SearchCommitsDeps {
	repoRoot: string;
	logForPattern: (repoRoot: string, pattern: string, limit: number) => Promise<RawLogRecord[]>;
}

export class SearchCommitsTool implements vscode.LanguageModelTool<SearchCommitsInput> {
	constructor(private readonly deps: SearchCommitsDeps) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<SearchCommitsInput>,
	): Promise<vscode.LanguageModelToolResult> {
		const limit = options.input.limit ?? 10;
		const records = await this.deps.logForPattern(this.deps.repoRoot, options.input.pattern, limit);

		if (records.length === 0) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('No commits found matching pattern.'),
			]);
		}

		const lines: string[] = [];
		for (const record of records) {
			const date = new Date(record.authorDate).toLocaleDateString();
			lines.push(`${record.shortSha} ${record.subject} — ${record.authorName} (${date})`);
		}

		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(lines.join('\n'))]);
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<SearchCommitsInput>,
	): Promise<vscode.PreparedToolInvocation> {
		return {
			invocationMessage: `Searching for commits matching "${options.input.pattern}"…`,
		};
	}
}
