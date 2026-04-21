import * as vscode from 'vscode';
import { BaselineStore } from '../baseline';
import { isFileDirty, relativeTo } from '../git/cli';
import { findRepository } from '../git/api';
import { relativeTime } from './format';
import {
	DEFAULT_GROUPING,
	describeFilters,
	EMPTY_FILTERS,
	filterEntries,
	groupEntries,
	hasActiveFilters,
	type HistoryFilters,
	type HistoryGrouping,
	type PersistedHistoryState,
} from './filters';
import {
	getFileHistory,
	HISTORY_PAGE_SIZE,
	HistoryCache,
	type HistoryContext,
	type HistoryEntry,
} from './service';

export type HistoryNode =
	| {
			kind: 'entry';
			entry: HistoryEntry;
			repoRoot: string;
			relPath: string;
			previousSha?: string;
	  }
	| { kind: 'workingTree'; repoRoot: string; relPath: string }
	| { kind: 'loadMore'; nextLimit: number }
	| { kind: 'group'; label: string; count: number; children: HistoryNode[] }
	| { kind: 'placeholder'; message: string };

export const PLACEHOLDER_MESSAGES = {
	idle: 'Open a file in a git repository to see its history.',
	empty: 'No history found for this file.',
	loading: 'Loading history…',
} as const;

export const WORKING_TREE_LABEL = '● Working tree (uncommitted changes)';
export const LOAD_MORE_LABEL = 'Load more…';

export function iconIdFor(entry: HistoryEntry, currentBaseline: string | undefined): string {
	if (currentBaseline === entry.sha) return 'target';
	if (entry.isMerge) return 'git-merge';
	return 'git-commit';
}

export function descriptionFor(entry: HistoryEntry, now: Date = new Date()): string {
	const base = `${entry.authorName} · ${relativeTime(entry.authorDate, now)}`;
	return entry.renamedFrom ? `${base} · renamed from ${entry.renamedFrom}` : base;
}

export function escapeMarkdown(value: string): string {
	return value.replace(/[\\`*_{}[\]()#+\-.!|>]/g, (c) => `\\${c}`);
}

export function buildTooltipMarkdown(entry: HistoryEntry): string {
	const parts: string[] = [];
	parts.push(`**${escapeMarkdown(entry.subject || '(no subject)')}**\n\n`);
	if (entry.body) {
		parts.push(`${escapeMarkdown(entry.body)}\n\n`);
	}
	parts.push(
		`\`${entry.shortSha}\` · ${escapeMarkdown(entry.authorName)} <${escapeMarkdown(entry.authorEmail)}>\n\n`,
	);
	if (entry.renamedFrom) {
		parts.push(`Renamed from \`${escapeMarkdown(entry.renamedFrom)}\`\n\n`);
	}
	parts.push(entry.authorDate.toISOString());
	return parts.join('');
}

export class HistoryProvider implements vscode.TreeDataProvider<HistoryNode> {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;

	private context: HistoryContext | undefined;
	private loading = false;
	private loadedForUri: string | undefined;
	private currentFileUri: vscode.Uri | undefined;
	private isDirty = false;
	private currentLimit = HISTORY_PAGE_SIZE;
	private readonly cache: HistoryCache;
	private readonly filterChangeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeFilters = this.filterChangeEmitter.event;
	private filters: HistoryFilters = { ...EMPTY_FILTERS };
	private grouping: HistoryGrouping = DEFAULT_GROUPING;

	constructor(
		private readonly baseline: BaselineStore,
		cache?: HistoryCache,
	) {
		this.cache = cache ?? new HistoryCache();
		baseline.onDidChange(() => this.changeEmitter.fire());
	}

	getCache(): HistoryCache {
		return this.cache;
	}

	getFilters(): HistoryFilters {
		return this.filters;
	}

	getGrouping(): HistoryGrouping {
		return this.grouping;
	}

	setFilters(next: HistoryFilters): void {
		this.filters = { ...next };
		this.filterChangeEmitter.fire();
		this.changeEmitter.fire();
	}

	setGrouping(next: HistoryGrouping): void {
		this.grouping = next;
		this.filterChangeEmitter.fire();
		this.changeEmitter.fire();
	}

	restorePersistedState(state: PersistedHistoryState | undefined): void {
		if (!state) return;
		this.filters = { ...EMPTY_FILTERS, ...state.filters };
		this.grouping = state.grouping ?? DEFAULT_GROUPING;
	}

	getPersistedState(): PersistedHistoryState {
		return { filters: { ...this.filters }, grouping: this.grouping };
	}

	describeState(): string {
		return describeFilters(this.filters, this.grouping);
	}

	hasActiveFilters(): boolean {
		return hasActiveFilters(this.filters);
	}

	async refresh(uri?: vscode.Uri): Promise<void> {
		const target = uri ?? vscode.window.activeTextEditor?.document.uri;
		if (!target || target.scheme !== 'file') {
			this.context = undefined;
			this.loadedForUri = undefined;
			this.currentFileUri = undefined;
			this.isDirty = false;
			this.currentLimit = HISTORY_PAGE_SIZE;
			this.changeEmitter.fire();
			return;
		}
		const targetKey = target.toString();
		const sameFile = this.loadedForUri === targetKey;
		if (sameFile && !uri) {
			return;
		}
		// Switching files resets pagination; an explicit refresh of the same
		// file preserves the currentLimit so "Load more" state survives reloads.
		if (!sameFile) {
			this.currentLimit = HISTORY_PAGE_SIZE;
		}
		this.currentFileUri = target;
		this.loading = true;
		this.changeEmitter.fire();
		try {
			const context = await getFileHistory(target, this.currentLimit, undefined, this.cache);
			const dirty = await this.checkDirty(target);
			this.context = context;
			this.isDirty = dirty;
			// Only remember the URI as loaded if the load actually succeeded.
			// Otherwise a transient failure (Git extension still discovering
			// repositories, network hiccup, etc.) would stick forever because
			// the early-return at the top of refresh() would skip retries.
			if (context) {
				this.loadedForUri = targetKey;
			} else {
				this.loadedForUri = undefined;
			}
		} finally {
			this.loading = false;
			this.changeEmitter.fire();
		}
	}

	async loadMore(): Promise<void> {
		if (!this.currentFileUri || !this.context?.hasMore) return;
		this.currentLimit += HISTORY_PAGE_SIZE;
		await this.refresh(this.currentFileUri);
	}

	invalidateAndRefresh(repoRoot?: string): void {
		if (repoRoot) this.cache.invalidateRepo(repoRoot);
		else this.cache.clear();
		// Force a reload by clearing loadedForUri so refresh() doesn't short-circuit.
		this.loadedForUri = undefined;
		void this.refresh(this.currentFileUri);
	}

	private async checkDirty(uri: vscode.Uri): Promise<boolean> {
		const repo = await findRepository(uri);
		if (!repo) return false;
		const rel = relativeTo(repo.rootUri.fsPath, uri.fsPath);
		if (!rel || rel.startsWith('..')) return false;
		return isFileDirty(repo.rootUri.fsPath, rel);
	}

	getCurrentContext(): HistoryContext | undefined {
		return this.context;
	}

	getTreeItem(node: HistoryNode): vscode.TreeItem {
		if (node.kind === 'placeholder') {
			const item = new vscode.TreeItem(node.message);
			item.contextValue = 'timeTraveller.history.placeholder';
			return item;
		}
		if (node.kind === 'group') {
			const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
			item.description = `${node.count}`;
			item.iconPath = new vscode.ThemeIcon('folder');
			item.contextValue = 'timeTraveller.history.group';
			return item;
		}
		if (node.kind === 'loadMore') {
			const item = new vscode.TreeItem(LOAD_MORE_LABEL);
			item.iconPath = new vscode.ThemeIcon('chevron-down');
			item.contextValue = 'timeTraveller.history.loadMore';
			item.command = {
				command: 'timeTraveller.history.loadMore',
				title: 'Load more history',
			};
			return item;
		}
		if (node.kind === 'workingTree') {
			const item = new vscode.TreeItem(WORKING_TREE_LABEL);
			item.description = 'not yet committed';
			item.iconPath = new vscode.ThemeIcon('edit');
			item.contextValue = 'timeTraveller.history.workingTree';
			item.tooltip = 'Your local changes to this file since HEAD.';
			item.command = {
				command: 'timeTraveller.history.clearFileBaseline',
				title: 'Compare working tree to HEAD',
				arguments: [node],
			};
			return item;
		}
		const { entry } = node;
		const item = new vscode.TreeItem(entry.subject || '(no subject)');
		item.description = descriptionFor(entry);
		const tooltip = new vscode.MarkdownString(buildTooltipMarkdown(entry));
		tooltip.isTrusted = false;
		item.tooltip = tooltip;
		item.iconPath = new vscode.ThemeIcon(iconIdFor(entry, this.baseline.get(this.currentFileUri)));
		item.contextValue = 'timeTraveller.history.entry';
		item.command = {
			command: 'timeTraveller.history.setBaseline',
			title: 'Set as baseline',
			arguments: [node],
		};
		return item;
	}

	getChildren(node?: HistoryNode): HistoryNode[] {
		if (node) {
			return node.kind === 'group' ? node.children : [];
		}
		if (this.loading) {
			return [{ kind: 'placeholder', message: PLACEHOLDER_MESSAGES.loading }];
		}
		if (!this.context) {
			return [{ kind: 'placeholder', message: PLACEHOLDER_MESSAGES.idle }];
		}
		const ctx = this.context;
		const workingTreeRow: HistoryNode[] =
			this.isDirty && ctx.entries.length > 0
				? [{ kind: 'workingTree', repoRoot: ctx.repoRoot, relPath: ctx.relPath }]
				: [];
		if (ctx.entries.length === 0) {
			return [{ kind: 'placeholder', message: PLACEHOLDER_MESSAGES.empty }];
		}
		const filtered = filterEntries(ctx.entries, this.filters);
		const loadMoreRow: HistoryNode[] = ctx.hasMore
			? [{ kind: 'loadMore', nextLimit: ctx.limit + HISTORY_PAGE_SIZE }]
			: [];
		if (filtered.length === 0) {
			// "Load more" still offered — the next page may contain matches.
			return [
				...workingTreeRow,
				{ kind: 'placeholder', message: 'No commits match the current filters.' },
				...loadMoreRow,
			];
		}
		const toEntryNode = (entry: HistoryEntry, idx: number, arr: HistoryEntry[]): HistoryNode => ({
			kind: 'entry',
			entry,
			repoRoot: ctx.repoRoot,
			relPath: ctx.relPath,
			previousSha: arr[idx + 1]?.sha,
		});
		if (this.grouping === 'none') {
			return [...workingTreeRow, ...filtered.map(toEntryNode), ...loadMoreRow];
		}
		const groups = groupEntries(filtered, this.grouping);
		const groupNodes: HistoryNode[] = groups.map((g) => ({
			kind: 'group',
			label: g.label,
			count: g.entries.length,
			children: g.entries.map(toEntryNode),
		}));
		return [...workingTreeRow, ...groupNodes, ...loadMoreRow];
	}
}
