import * as vscode from 'vscode';
import type { PRLookupInput } from '../pr/service';

export interface FindPRsForCommitInput {
	sha: string;
}

export interface FindPRsForCommitDeps {
	repoRoot: string;
	lookupPRs: (input: PRLookupInput) => Promise<Map<string, unknown>>;
}

export class FindPRsForCommitTool implements vscode.LanguageModelTool<FindPRsForCommitInput> {
	constructor(private readonly deps: FindPRsForCommitDeps) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<FindPRsForCommitInput>,
	): Promise<vscode.LanguageModelToolResult> {
		const prs = await this.deps.lookupPRs({
			repoRoot: this.deps.repoRoot,
			shas: [options.input.sha],
			cache: { get: () => undefined, set: () => {} } as any,
		});

		if (prs.size === 0) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('No PRs found for this commit.'),
			]);
		}

		const lines: string[] = [];
		for (const [, pr] of prs) {
			const state = (pr as any).merged ? 'merged' : (pr as any).state;
			lines.push(`PR #${(pr as any).number} (${state}): ${(pr as any).title} — ${(pr as any).url}`);
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
