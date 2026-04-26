import * as vscode from 'vscode';

export interface CommitDetails {
	sha: string;
	subject: string;
	body: string;
	authorName: string;
	authorDate: Date;
	files: Array<{ path: string; additions: number; deletions: number; binary: boolean }>;
}

export interface GetCommitDetailsDeps {
	repoRoot: string;
	gitShow: (sha: string) => Promise<CommitDetails>;
}

export class GetCommitDetailsTool implements vscode.LanguageModelTool<{
	sha: string;
	includeFiles?: boolean;
}> {
	constructor(private readonly deps: GetCommitDetailsDeps) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<{ sha: string; includeFiles?: boolean }>,
	): Promise<vscode.LanguageModelToolResult> {
		const details = await this.deps.gitShow(options.input.sha);
		const lines = [
			`Commit \`${details.sha.slice(0, 7)}\``,
			`Author: ${details.authorName}`,
			`Date: ${details.authorDate.toISOString()}`,
			'',
			details.subject,
			'',
			details.body,
		];
		if (options.input.includeFiles) {
			lines.push('', 'Files changed:');
			for (const f of details.files) {
				lines.push(
					f.binary ? `- ${f.path} (binary)` : `- ${f.path} (+${f.additions} -${f.deletions})`,
				);
			}
		}
		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(lines.join('\n'))]);
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<{ sha: string }>,
	): Promise<vscode.PreparedToolInvocation> {
		return {
			invocationMessage: `Reading commit ${options.input.sha.slice(0, 7)}…`,
		};
	}
}
