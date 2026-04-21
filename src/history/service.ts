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
	/** True when the backing `git log` returned as many records as requested —
	 * i.e. there are (probably) older commits we haven't loaded yet. */
	hasMore: boolean;
	/** The `maxCount` used to produce `entries`. Pagination UI uses this to
	 * build the next page request. */
	limit: number;
}

export const HISTORY_PAGE_SIZE = 50;
/** Kept as a back-compat alias; new code should use pagination instead of
 * reaching for a single fat fetch. */
export const DEFAULT_MAX_HISTORY = HISTORY_PAGE_SIZE;

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
	maxCount: number = HISTORY_PAGE_SIZE,
	deps: HistoryServiceDeps = defaultDeps,
	cache?: HistoryCache,
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
	const cached = cache?.get(repoRoot, relPath, maxCount);
	if (cached) return cached;
	const [records, pathsBySha] = await Promise.all([
		deps.log(repoRoot, relPath, maxCount),
		deps.renames(repoRoot, relPath, maxCount),
	]);
	const entries = applyRenames(records.map(toHistoryEntry), pathsBySha);
	const context: HistoryContext = {
		repoRoot,
		relPath,
		entries,
		limit: maxCount,
		// If git returned exactly as many records as we asked for, assume there
		// are more. The only false positive is "repo has exactly N commits
		// touching this file"; the follow-up page load returns [] and the UI
		// hides "Load more" on the next render.
		hasMore: records.length >= maxCount,
	};
	cache?.set(repoRoot, relPath, maxCount, context);
	return context;
}

/**
 * Tiny FIFO cache keyed by `(repoRoot, relPath, limit)`. Scope is intentionally
 * modest: memoize within a session so re-renders (baseline change, editor
 * focus flicker) don't re-shell `git log`, and invalidate in bulk when a repo's
 * state changes (branch switch, HEAD move, fetch).
 */
export class HistoryCache {
	private readonly map = new Map<string, HistoryContext>();

	constructor(private readonly maxEntries: number = 64) {}

	private key(repoRoot: string, relPath: string, limit: number): string {
		return `${repoRoot}\x1F${relPath}\x1F${limit}`;
	}

	get(repoRoot: string, relPath: string, limit: number): HistoryContext | undefined {
		const k = this.key(repoRoot, relPath, limit);
		const hit = this.map.get(k);
		if (hit) {
			// Bump to MRU position so bulk eviction prefers stale entries.
			this.map.delete(k);
			this.map.set(k, hit);
		}
		return hit;
	}

	set(repoRoot: string, relPath: string, limit: number, value: HistoryContext): void {
		const k = this.key(repoRoot, relPath, limit);
		this.map.delete(k);
		this.map.set(k, value);
		while (this.map.size > this.maxEntries) {
			const oldest = this.map.keys().next().value;
			if (oldest === undefined) break;
			this.map.delete(oldest);
		}
	}

	invalidateRepo(repoRoot: string): void {
		const prefix = `${repoRoot}\x1F`;
		for (const k of [...this.map.keys()]) {
			if (k.startsWith(prefix)) this.map.delete(k);
		}
	}

	invalidateFile(repoRoot: string, relPath: string): void {
		const prefix = `${repoRoot}\x1F${relPath}\x1F`;
		for (const k of [...this.map.keys()]) {
			if (k.startsWith(prefix)) this.map.delete(k);
		}
	}

	clear(): void {
		this.map.clear();
	}

	get size(): number {
		return this.map.size;
	}
}
