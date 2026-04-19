import * as vscode from 'vscode';
import { findRepository } from '../git/api';
import { logFile, relativeTo } from '../git/cli';

export interface HistoryEntry {
	sha: string;
	shortSha: string;
	subject: string;
	body: string;
	authorName: string;
	authorEmail: string;
	authorDate: Date;
	parents: string[];
	isMerge: boolean;
}

export interface HistoryContext {
	repoRoot: string;
	relPath: string;
	entries: HistoryEntry[];
}

const DEFAULT_MAX = 200;

export async function getFileHistory(
	uri: vscode.Uri,
	maxCount: number = DEFAULT_MAX,
): Promise<HistoryContext | undefined> {
	if (uri.scheme !== 'file') {
		return undefined;
	}
	const repo = await findRepository(uri);
	if (!repo) {
		return undefined;
	}
	const repoRoot = repo.rootUri.fsPath;
	const relPath = relativeTo(repoRoot, uri.fsPath);
	if (!relPath || relPath.startsWith('..')) {
		return undefined;
	}
	const records = await logFile(repoRoot, relPath, maxCount);
	const entries = records.map<HistoryEntry>((r) => {
		const parents = r.parents ? r.parents.split(' ').filter(Boolean) : [];
		return {
			sha: r.sha,
			shortSha: r.shortSha,
			subject: r.subject,
			body: r.body,
			authorName: r.authorName,
			authorEmail: r.authorEmail,
			authorDate: new Date(r.authorDate),
			parents,
			isMerge: parents.length > 1,
		};
	});
	return { repoRoot, relPath, entries };
}
