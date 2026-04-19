import * as vscode from 'vscode';
import { BaselineStore } from '../baseline';
import { isFileDirty, relativeTo } from '../git/cli';
import { findRepository } from '../git/api';
import { relativeTime } from './format';
import { getFileHistory, type HistoryContext, type HistoryEntry } from './service';

export type HistoryNode =
	| {
			kind: 'entry';
			entry: HistoryEntry;
			repoRoot: string;
			relPath: string;
			previousSha?: string;
	  }
	| { kind: 'workingTree'; repoRoot: string; relPath: string }
	| { kind: 'placeholder'; message: string };

export const PLACEHOLDER_MESSAGES = {
	idle: 'Open a file in a git repository to see its history.',
	empty: 'No history found for this file.',
	loading: 'Loading history…',
} as const;

export const WORKING_TREE_LABEL = '● Working tree (uncommitted changes)';

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

	constructor(private readonly baseline: BaselineStore) {
		baseline.onDidChange(() => this.changeEmitter.fire());
	}

	async refresh(uri?: vscode.Uri): Promise<void> {
		const target = uri ?? vscode.window.activeTextEditor?.document.uri;
		if (!target || target.scheme !== 'file') {
			this.context = undefined;
			this.loadedForUri = undefined;
			this.currentFileUri = undefined;
			this.isDirty = false;
			this.changeEmitter.fire();
			return;
		}
		if (this.loadedForUri === target.toString() && !uri) {
			return;
		}
		this.currentFileUri = target;
		this.loading = true;
		this.changeEmitter.fire();
		try {
			this.context = await getFileHistory(target);
			this.isDirty = await this.checkDirty(target);
			this.loadedForUri = target.toString();
		} finally {
			this.loading = false;
			this.changeEmitter.fire();
		}
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
			return [];
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
		const entryNodes: HistoryNode[] = ctx.entries.map((entry, idx, arr) => ({
			kind: 'entry',
			entry,
			repoRoot: ctx.repoRoot,
			relPath: ctx.relPath,
			previousSha: arr[idx + 1]?.sha,
		}));
		return [...workingTreeRow, ...entryNodes];
	}
}
