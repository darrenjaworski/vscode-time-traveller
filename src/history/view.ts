import * as vscode from 'vscode';
import { BaselineStore } from '../baseline';
import { findRepository } from '../git/api';
import { makeTimeTravellerUri } from '../quickDiff';
import { buildCommitUrl, parseRemoteUrl } from '../remote';
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
				await baseline.setForFile(fileUriOf(node), node.entry.sha);
			},
		),

		vscode.commands.registerCommand(
			'timeTraveller.history.setAsGlobalBaseline',
			async (node: HistoryNode) => {
				if (node?.kind !== 'entry') return;
				await baseline.set(node.entry.sha);
			},
		),

		vscode.commands.registerCommand(
			'timeTraveller.history.clearFileBaseline',
			async (node: HistoryNode) => {
				if (node?.kind !== 'workingTree') return;
				await baseline.clearForFile(fileUriOf(node));
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
			const right = fileUriOf(node);
			const title = `${node.relPath} (${node.entry.shortSha}) ↔ Working Tree`;
			await vscode.commands.executeCommand('vscode.diff', left, right, title);
		}),

		vscode.commands.registerCommand(
			'timeTraveller.history.openDiffPrev',
			async (node: HistoryNode) => {
				if (node?.kind !== 'entry') return;
				if (!node.previousSha) {
					vscode.window.setStatusBarMessage(
						'No earlier revision of this file in the loaded history.',
						2500,
					);
					return;
				}
				const left = makeTimeTravellerUri(node.repoRoot, node.relPath, node.previousSha);
				const right = makeTimeTravellerUri(node.repoRoot, node.relPath, node.entry.sha);
				const shortPrev = node.previousSha.slice(0, 7);
				const title = `${node.relPath} (${shortPrev}) ↔ (${node.entry.shortSha})`;
				await vscode.commands.executeCommand('vscode.diff', left, right, title);
			},
		),

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

		vscode.commands.registerCommand(
			'timeTraveller.history.openOnRemote',
			async (node: HistoryNode) => {
				if (node?.kind !== 'entry') return;
				const url = await resolveRemoteCommitUrl(node.repoRoot, node.entry.sha);
				if (!url) {
					vscode.window.showInformationMessage(
						'No recognized remote (GitHub / GitLab / Bitbucket) configured for this repository.',
					);
					return;
				}
				await vscode.env.openExternal(vscode.Uri.parse(url));
			},
		),
	);

	return vscode.Disposable.from(...disposables);
}

async function resolveRemoteCommitUrl(repoRoot: string, sha: string): Promise<string | undefined> {
	const repo = await findRepository(vscode.Uri.file(repoRoot));
	// The minimal Git API type we ship doesn't cover remotes; reach through
	// `unknown` to read them at runtime. If the shape changes we just degrade.
	const remotes = (
		repo as unknown as { state?: { remotes?: Array<{ fetchUrl?: string; pushUrl?: string }> } }
	)?.state?.remotes;
	if (!remotes || remotes.length === 0) return undefined;
	for (const remote of remotes) {
		const url = remote.fetchUrl ?? remote.pushUrl;
		if (!url) continue;
		const info = parseRemoteUrl(url);
		if (info) return buildCommitUrl(info, sha);
	}
	return undefined;
}

function fileUriOf(node: { repoRoot: string; relPath: string }): vscode.Uri {
	return vscode.Uri.file(`${node.repoRoot}/${node.relPath}`);
}

function debounce<F extends (...args: never[]) => void>(fn: F, ms: number): F {
	let handle: ReturnType<typeof setTimeout> | undefined;
	return ((...args: Parameters<F>) => {
		if (handle) clearTimeout(handle);
		handle = setTimeout(() => fn(...args), ms);
	}) as F;
}
