import * as vscode from 'vscode';
import { GetCommitDetailsTool } from './getCommitDetails';
// Future: import other tools here

export function registerTools(repoRoot: string): vscode.Disposable[] {
	return [
		vscode.lm.registerTool(
			'timeTraveller_getCommitDetails',
			new GetCommitDetailsTool({
				repoRoot,
				gitShow: async (sha) => {
					// Wire to src/git/cli.ts: gitShow(repoRoot, sha)
					// For now, return a stub that will be integrated in Task 4
					return {
						sha,
						subject: '',
						body: '',
						authorName: '',
						authorDate: new Date(),
						files: [],
					};
				},
			}),
		),
	];
}
