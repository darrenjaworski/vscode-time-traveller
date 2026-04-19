import * as vscode from 'vscode';
import { BaselineStore } from '../baseline';
import { relativeTime } from './format';
import { getFileHistory, type HistoryContext, type HistoryEntry } from './service';

export type HistoryNode =
	| { kind: 'entry'; entry: HistoryEntry; repoRoot: string; relPath: string }
	| { kind: 'placeholder'; message: string };

export class HistoryProvider implements vscode.TreeDataProvider<HistoryNode> {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;

	private context: HistoryContext | undefined;
	private loading = false;
	private loadedForUri: string | undefined;

	constructor(private readonly baseline: BaselineStore) {
		baseline.onDidChange(() => this.changeEmitter.fire());
	}

	async refresh(uri?: vscode.Uri): Promise<void> {
		const target = uri ?? vscode.window.activeTextEditor?.document.uri;
		if (!target || target.scheme !== 'file') {
			this.context = undefined;
			this.loadedForUri = undefined;
			this.changeEmitter.fire();
			return;
		}
		if (this.loadedForUri === target.toString() && !uri) {
			return;
		}
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
		item.description = `${entry.authorName} · ${relativeTime(entry.authorDate)}`;
		item.tooltip = buildTooltip(entry);
		item.iconPath = new vscode.ThemeIcon(
			this.baseline.get() === entry.sha ? 'target' : entry.isMerge ? 'git-merge' : 'git-commit',
		);
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
			return [{ kind: 'placeholder', message: 'Loading history…' }];
		}
		if (!this.context) {
			return [
				{
					kind: 'placeholder',
					message: 'Open a file in a git repository to see its history.',
				},
			];
		}
		if (this.context.entries.length === 0) {
			return [{ kind: 'placeholder', message: 'No history found for this file.' }];
		}
		return this.context.entries.map((entry) => ({
			kind: 'entry',
			entry,
			repoRoot: this.context!.repoRoot,
			relPath: this.context!.relPath,
		}));
	}
}

function buildTooltip(entry: HistoryEntry): vscode.MarkdownString {
	const md = new vscode.MarkdownString();
	md.isTrusted = false;
	md.appendMarkdown(`**${escapeMd(entry.subject || '(no subject)')}**\n\n`);
	if (entry.body) {
		md.appendMarkdown(`${escapeMd(entry.body)}\n\n`);
	}
	md.appendMarkdown(
		`\`${entry.shortSha}\` · ${escapeMd(entry.authorName)} <${escapeMd(entry.authorEmail)}>\n\n`,
	);
	md.appendMarkdown(`${entry.authorDate.toISOString()}`);
	return md;
}

function escapeMd(s: string): string {
	return s.replace(/[\\`*_{}[\]()#+\-.!|>]/g, (c) => `\\${c}`);
}
