import * as vscode from 'vscode';
import { BaselineStore } from '../baseline';
import { findRepository, getGitAPI } from '../git/api';
import { makeTimeTravellerUri } from '../quickDiff';
import { buildCommitUrl, parseRemoteUrl } from '../remote';
import type { HistoryGrouping, PersistedHistoryState } from './filters';
import { HistoryProvider, type HistoryNode } from './provider';

const PERSIST_KEY = 'timeTraveller.history.state';

export function registerHistoryView(
	baseline: BaselineStore,
	workspaceState?: vscode.Memento,
): vscode.Disposable {
	const provider = new HistoryProvider(baseline);
	const disposables: vscode.Disposable[] = [];

	const persisted = workspaceState?.get<PersistedHistoryState>(PERSIST_KEY);
	provider.restorePersistedState(persisted);

	const treeView = vscode.window.createTreeView('timeTraveller.fileHistory', {
		treeDataProvider: provider,
		showCollapseAll: true,
	});
	disposables.push(treeView);

	const applyViewDecorations = () => {
		const desc = provider.describeState();
		treeView.description = desc.length > 0 ? desc : undefined;
		void vscode.commands.executeCommand(
			'setContext',
			'timeTraveller.history.hasFilters',
			provider.hasActiveFilters(),
		);
	};
	applyViewDecorations();
	disposables.push(
		provider.onDidChangeFilters(() => {
			applyViewDecorations();
			if (workspaceState) {
				void workspaceState.update(PERSIST_KEY, provider.getPersistedState());
			}
		}),
	);

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

	// The built-in Git extension discovers repositories asynchronously. If our
	// first `refresh()` races ahead of that discovery, `getFileHistory` returns
	// undefined and the panel sits on the idle placeholder. Re-trigger when
	// repos show up so the panel self-heals.
	void getGitAPI().then((api) => {
		if (!api) return;
		// Per-repo subscriptions for `state.onDidChange` so branch switches,
		// HEAD moves, fetches, and merges bust the cache for that repo.
		const repoSubs = new Map<string, vscode.Disposable>();
		const subscribe = (repo: {
			rootUri: vscode.Uri;
			state: { onDidChange: vscode.Event<void> };
		}) => {
			const key = repo.rootUri.fsPath;
			if (repoSubs.has(key)) return;
			const sub = repo.state.onDidChange(() => {
				provider.invalidateAndRefresh(key);
			});
			repoSubs.set(key, sub);
		};
		const unsubscribe = (repo: { rootUri: vscode.Uri }) => {
			const key = repo.rootUri.fsPath;
			repoSubs.get(key)?.dispose();
			repoSubs.delete(key);
			provider.getCache().invalidateRepo(key);
		};
		for (const repo of api.repositories) subscribe(repo);
		disposables.push(
			api.onDidOpenRepository((repo) => {
				subscribe(repo);
				scheduleRefresh();
			}),
			api.onDidCloseRepository((repo) => {
				unsubscribe(repo);
				scheduleRefresh();
			}),
			new vscode.Disposable(() => {
				for (const sub of repoSubs.values()) sub.dispose();
				repoSubs.clear();
			}),
		);
		// Also retry now in case the API was already populated but our first
		// refresh ran before the await resolved.
		scheduleRefresh();
	});

	void provider.refresh();

	disposables.push(
		vscode.commands.registerCommand('timeTraveller.history.refresh', () => {
			provider.invalidateAndRefresh();
		}),

		vscode.commands.registerCommand('timeTraveller.history.loadMore', () => provider.loadMore()),

		vscode.commands.registerCommand('timeTraveller.history.setTextFilter', async () => {
			const current = provider.getFilters();
			const typed = await vscode.window.showInputBox({
				prompt: 'Filter commits by subject or body text (leave empty to clear)',
				placeHolder: 'e.g. "fix login", "refactor", case-insensitive',
				value: current.text ?? '',
			});
			if (typed === undefined) return;
			provider.setFilters({ ...current, text: typed.trim().length > 0 ? typed : undefined });
		}),

		vscode.commands.registerCommand('timeTraveller.history.toggleHideMerges', () => {
			const current = provider.getFilters();
			provider.setFilters({ ...current, hideMerges: !current.hideMerges });
		}),

		vscode.commands.registerCommand('timeTraveller.history.setGrouping', async () => {
			const current = provider.getGrouping();
			const picked = await vscode.window.showQuickPick(
				[
					{ label: 'None', value: 'none' as HistoryGrouping },
					{ label: 'By date', value: 'date' as HistoryGrouping },
					{ label: 'By author', value: 'author' as HistoryGrouping },
				].map((o) => ({ ...o, description: o.value === current ? '(current)' : undefined })),
				{ placeHolder: 'Group file history by…' },
			);
			if (!picked) return;
			provider.setGrouping(picked.value);
		}),

		vscode.commands.registerCommand('timeTraveller.history.clearFilters', () => {
			provider.setFilters({});
			provider.setGrouping('none');
		}),

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

		vscode.commands.registerCommand(
			'timeTraveller.history.askHistorian',
			async (node: HistoryNode) => {
				if (node?.kind !== 'entry') return;
				const query = `@historian why did commit ${node.entry.shortSha} (${node.entry.subject}) change ${node.relPath}?`;
				await vscode.commands.executeCommand('workbench.action.chat.open', { query });
			},
		),

		vscode.commands.registerCommand(
			'timeTraveller.history.storyOfCommit',
			async (node: HistoryNode) => {
				if (node?.kind !== 'entry') return;
				const query = `@historian /story ${node.entry.shortSha} — tell the story of this commit (${node.entry.subject})`;
				await vscode.commands.executeCommand('workbench.action.chat.open', { query });
			},
		),

		vscode.commands.registerCommand('timeTraveller.history.askHistorianAboutFile', async () => {
			const ctx = provider.getCurrentContext();
			const activeUri = vscode.window.activeTextEditor?.document.uri;
			const rel =
				ctx?.relPath ??
				(activeUri?.scheme === 'file' ? vscode.workspace.asRelativePath(activeUri) : undefined);
			if (!rel) {
				vscode.window.setStatusBarMessage(
					'Open a tracked file to ask @historian about its history.',
					2500,
				);
				return;
			}
			const query = `@historian /story ${rel}`;
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
		// Only build URLs for recognized hosts, not 'unknown'
		if (info && info.host !== 'unknown') return buildCommitUrl(info, sha);
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
