import * as vscode from 'vscode';
import { GetCommitDetailsTool } from './getCommitDetails';
import { SearchCommitsTool } from './searchCommits';
import { GetCommitDiffTool } from './getCommitDiff';
import { GetBlameTool } from './getBlameTool';
import { logForPattern, showCommitPatch, blameRange } from '../git/cli';
import { trimPatch } from '../historian/diff';
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
		vscode.lm.registerTool(
			'timeTraveller_searchCommits',
			new SearchCommitsTool({
				repoRoot,
				logForPattern,
			}),
		),
		vscode.lm.registerTool(
			'timeTraveller_getCommitDiff',
			new GetCommitDiffTool({
				repoRoot,
				showCommitPatch,
				trimPatch,
			}),
		),
		vscode.lm.registerTool(
			'timeTraveller_getBlame',
			new GetBlameTool({
				repoRoot,
				blameRange,
			}),
		),
	];
}
