import * as vscode from 'vscode';
import { findRepository } from '../git/api';
import { logFile, logFileRenames, relativeTo, type RawLogRecord } from '../git/cli';

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
	/** The path this file had *before* this commit, when the path changes
	 * between this entry and the next (older) one in the log. Presence
	 * indicates a rename landed in (or was observed entering) this commit. */
	renamedFrom?: string;
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

/**
 * Given entries (newest → oldest) and a `sha → path` map, annotate each entry
 * with a `renamedFrom` when the adjacent older entry had a different path.
 * Pure: mutates and returns the same array so callers can chain.
 */
export function applyRenames(
	entries: HistoryEntry[],
	pathsBySha: Map<string, string>,
): HistoryEntry[] {
	for (let i = 0; i < entries.length - 1; i++) {
		const cur = pathsBySha.get(entries[i].sha);
		const next = pathsBySha.get(entries[i + 1].sha);
		if (cur && next && cur !== next) {
			entries[i].renamedFrom = next;
		}
	}
	return entries;
}

export interface HistoryServiceDeps {
	findRepo: typeof findRepository;
	log: typeof logFile;
	renames: typeof logFileRenames;
}

const defaultDeps: HistoryServiceDeps = {
	findRepo: findRepository,
	log: logFile,
	renames: logFileRenames,
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
	const [records, pathsBySha] = await Promise.all([
		deps.log(repoRoot, relPath, maxCount),
		deps.renames(repoRoot, relPath, maxCount),
	]);
	const entries = applyRenames(records.map(toHistoryEntry), pathsBySha);
	return { repoRoot, relPath, entries };
}
