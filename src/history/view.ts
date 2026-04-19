import * as vscode from 'vscode';
import { BaselineStore } from '../baseline';
import { makeTimeTravellerUri } from '../quickDiff';
import { HistoryProvider, type HistoryNode } from './provider';

export function registerHistoryView(baseline: BaselineStore): vscode.Disposable {
	const provider = new HistoryProvider(baseline);
	const disposables: vscode.Disposable[] = [];

	const treeView = vscode.window.createTreeView('timeTraveller.fileHistory', {
		treeDataProvider: provider,
		showCollapseAll: false,
	});
	disposables.push(treeView);

	const scheduleRefresh = debounce(() => provider.refresh(), 150);
	disposables.push(
		vscode.window.onDidChangeActiveTextEditor(() => scheduleRefresh()),
		vscode.workspace.onDidSaveTextDocument((doc) => {
			const current = vscode.window.activeTextEditor?.document;
			if (current && doc.uri.toString() === current.uri.toString()) {
				provider.refresh(doc.uri);
			}
		}),
	);
	void provider.refresh();

	disposables.push(
		vscode.commands.registerCommand('timeTraveller.history.refresh', () => provider.refresh()),

		vscode.commands.registerCommand(
			'timeTraveller.history.setBaseline',
			async (node: HistoryNode) => {
				if (node?.kind !== 'entry') return;
				await baseline.set(node.entry.sha);
			},
		),

		vscode.commands.registerCommand(
			'timeTraveller.history.openAtRevision',
			async (node: HistoryNode) => {
				if (node?.kind !== 'entry') return;
				const uri = makeTimeTravellerUri(node.repoRoot, node.relPath, node.entry.sha);
				await vscode.commands.executeCommand('vscode.open', uri);
			},
		),

		vscode.commands.registerCommand('timeTraveller.history.openDiff', async (node: HistoryNode) => {
			if (node?.kind !== 'entry') return;
			const left = makeTimeTravellerUri(node.repoRoot, node.relPath, node.entry.sha);
			const right = vscode.Uri.file(workingTreePath(node.repoRoot, node.relPath));
			const title = `${node.relPath} (${node.entry.shortSha}) ↔ Working Tree`;
			await vscode.commands.executeCommand('vscode.diff', left, right, title);
		}),

		vscode.commands.registerCommand('timeTraveller.history.copySha', async (node: HistoryNode) => {
			if (node?.kind !== 'entry') return;
			await vscode.env.clipboard.writeText(node.entry.sha);
		}),

		vscode.commands.registerCommand(
			'timeTraveller.history.copySubject',
			async (node: HistoryNode) => {
				if (node?.kind !== 'entry') return;
				await vscode.env.clipboard.writeText(node.entry.subject);
			},
		),

		vscode.commands.registerCommand('timeTraveller.history.askBlame', async (node: HistoryNode) => {
			if (node?.kind !== 'entry') return;
			const query = `@blame why did commit ${node.entry.shortSha} (${node.entry.subject}) change ${node.relPath}?`;
			await vscode.commands.executeCommand('workbench.action.chat.open', { query });
		}),
	);

	return vscode.Disposable.from(...disposables);
}

function workingTreePath(repoRoot: string, relPath: string): string {
	return `${repoRoot}/${relPath}`;
}

function debounce<F extends (...args: never[]) => void>(fn: F, ms: number): F {
	let handle: ReturnType<typeof setTimeout> | undefined;
	return ((...args: Parameters<F>) => {
		if (handle) clearTimeout(handle);
		handle = setTimeout(() => fn(...args), ms);
	}) as F;
}
