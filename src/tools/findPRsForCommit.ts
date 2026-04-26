import * as vscode from 'vscode';
import type { PRLookupInput } from '../pr/service';
import type { PRSummary } from '../pr/github';

export interface FindPRsForCommitInput {
	sha: string;
}

export interface FindPRsForCommitDeps {
	repoRoot: string;
	lookupPRs: (input: PRLookupInput) => Promise<Map<string, PRSummary>>;
}

export class FindPRsForCommitTool implements vscode.LanguageModelTool<FindPRsForCommitInput> {
	constructor(private readonly deps: FindPRsForCommitDeps) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<FindPRsForCommitInput>,
	): Promise<vscode.LanguageModelToolResult> {
		const prs = await this.deps.lookupPRs({
			repoRoot: this.deps.repoRoot,
			shas: [options.input.sha],
			cache: { get: () => undefined, set: () => {} } as unknown as {
				get: (sha: string) => unknown;
				set: (sha: string, value: unknown) => void;
			},
		});

		if (prs.size === 0) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('No PRs found for this commit.'),
			]);
		}

		const lines: string[] = [];
		for (const [, pr] of prs) {
			const state = pr.merged ? 'merged' : pr.state;
			lines.push(`PR #${pr.number} (${state}): ${pr.title} — ${pr.url}`);
		}

		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(lines.join('\n'))]);
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<FindPRsForCommitInput>,
	): Promise<vscode.PreparedToolInvocation> {
		return {
			invocationMessage: `Looking up PRs for ${options.input.sha.slice(0, 7)}…`,
		};
	}
}
