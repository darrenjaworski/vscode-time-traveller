import * as vscode from 'vscode';
import { GetCommitDetailsTool } from './getCommitDetails';
import { SearchCommitsTool } from './searchCommits';
import { GetCommitDiffTool } from './getCommitDiff';
import { GetBlameTool } from './getBlameTool';
import { FindPRsForCommitTool } from './findPRsForCommit';
import { ListFileHistoryTool } from './listFileHistory';
import {
	logForPattern,
	showCommitPatch,
	showCommitMetadata,
	showCommitStat,
	blameRange,
	logFile,
	logFileSince,
	logFileByAuthor,
} from '../git/cli';
import { trimPatch } from '../historian/diff';
import { lookupPRs } from '../pr/service';
import { PRCache } from '../pr/cache';
// Future: import other tools here

export function registerTools(repoRoot: string): vscode.Disposable[] {
	const prCache = new PRCache();
	return [
		vscode.lm.registerTool(
			'timeTraveller_getCommitDetails',
			new GetCommitDetailsTool({
				repoRoot,
				gitShow: async (sha) => {
					const [meta, files] = await Promise.all([
						showCommitMetadata(repoRoot, sha),
						showCommitStat(repoRoot, sha),
					]);
					return {
						sha: meta?.sha ?? sha,
						subject: meta?.subject ?? '',
						body: meta?.body ?? '',
						authorName: meta?.authorName ?? '',
						authorDate: meta ? new Date(meta.authorDate) : new Date(0),
						files,
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
		vscode.lm.registerTool(
			'timeTraveller_findPRsForCommit',
			new FindPRsForCommitTool({
				repoRoot,
				cache: prCache,
				lookupPRs,
			}),
		),
		vscode.lm.registerTool(
			'timeTraveller_listFileHistory',
			new ListFileHistoryTool({
				repoRoot,
				logFile,
				logFileSince,
				logFileByAuthor,
			}),
		),
	];
}
