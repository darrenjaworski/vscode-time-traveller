import * as vscode from 'vscode';
import { findRepository } from '../git/api';
import { logFile, relativeTo, type RawLogRecord } from '../git/cli';

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

export const DEFAULT_MAX_HISTORY = 200;

export function toHistoryEntry(record: RawLogRecord): HistoryEntry {
	const parents = record.parents ? record.parents.split(' ').filter(Boolean) : [];
	return {
		sha: record.sha,
		shortSha: record.shortSha,
		subject: record.subject,
		body: record.body,
		authorName: record.authorName,
		authorEmail: record.authorEmail,
		authorDate: new Date(record.authorDate),
		parents,
		isMerge: parents.length > 1,
	};
}

export interface HistoryServiceDeps {
	findRepo: typeof findRepository;
	log: typeof logFile;
}

const defaultDeps: HistoryServiceDeps = {
	findRepo: findRepository,
	log: logFile,
};

export async function getFileHistory(
	uri: vscode.Uri,
	maxCount: number = DEFAULT_MAX_HISTORY,
	deps: HistoryServiceDeps = defaultDeps,
): Promise<HistoryContext | undefined> {
	if (uri.scheme !== 'file') {
		return undefined;
	}
	const repo = await deps.findRepo(uri);
	if (!repo) {
		return undefined;
	}
	const repoRoot = repo.rootUri.fsPath;
	const relPath = relativeTo(repoRoot, uri.fsPath);
	if (!relPath || relPath.startsWith('..')) {
		return undefined;
	}
	const records = await deps.log(repoRoot, relPath, maxCount);
	return { repoRoot, relPath, entries: records.map(toHistoryEntry) };
}
