import * as vscode from 'vscode';
import { BaselineStore } from '../baseline';
import { relativeTime } from './format';
import { getFileHistory, type HistoryContext, type HistoryEntry } from './service';

export type HistoryNode =
	| { kind: 'entry'; entry: HistoryEntry; repoRoot: string; relPath: string }
	| { kind: 'placeholder'; message: string };

export const PLACEHOLDER_MESSAGES = {
	idle: 'Open a file in a git repository to see its history.',
	empty: 'No history found for this file.',
	loading: 'Loading history…',
} as const;

export function iconIdFor(entry: HistoryEntry, currentBaseline: string | undefined): string {
	if (currentBaseline === entry.sha) return 'target';
	if (entry.isMerge) return 'git-merge';
	return 'git-commit';
}

export function descriptionFor(entry: HistoryEntry, now: Date = new Date()): string {
	return `${entry.authorName} · ${relativeTime(entry.authorDate, now)}`;
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

	constructor(private readonly baseline: BaselineStore) {
		baseline.onDidChange(() => this.changeEmitter.fire());
	}

	async refresh(uri?: vscode.Uri): Promise<void> {
		const target = uri ?? vscode.window.activeTextEditor?.document.uri;
		if (!target || target.scheme !== 'file') {
			this.context = undefined;
			this.loadedForUri = undefined;
			this.currentFileUri = undefined;
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
			this.loadedForUri = target.toString();
		} finally {
			this.loading = false;
			this.changeEmitter.fire();
		}
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
		if (this.context.entries.length === 0) {
			return [{ kind: 'placeholder', message: PLACEHOLDER_MESSAGES.empty }];
		}
		return this.context.entries.map((entry) => ({
			kind: 'entry',
			entry,
			repoRoot: this.context!.repoRoot,
			relPath: this.context!.relPath,
		}));
	}
}
