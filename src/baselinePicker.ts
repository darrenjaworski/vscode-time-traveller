import * as vscode from 'vscode';
import { findRepository, RefType, type Ref, type Repository } from './git/api';
import { logRecent } from './git/cli';

interface RefPick extends vscode.QuickPickItem {
	ref?: string;
	action?: 'custom' | 'clear';
}

export async function pickBaselineRef(
	currentRef: string | undefined,
): Promise<string | undefined | { clear: true }> {
	const activeUri = vscode.window.activeTextEditor?.document.uri;
	const repo = await (activeUri ? findRepository(activeUri) : firstRepoFromWorkspace());

	const items: RefPick[] = [];
	items.push({ label: 'Presets', kind: vscode.QuickPickItemKind.Separator });
	items.push({
		label: '$(git-commit) HEAD',
		description: 'current branch tip',
		ref: 'HEAD',
	});
	if (currentRef) {
		items.push({
			label: '$(circle-slash) Clear baseline',
			description: 'fall back to HEAD',
			action: 'clear',
		});
	}
	items.push({
		label: '$(edit) Enter a git ref…',
		description: 'type a branch name, tag, SHA, or stash',
		action: 'custom',
	});

	if (repo) {
		const branches = sortRefs(repo.state.refs.filter((r) => r.type === RefType.Head && !!r.name));
		if (branches.length > 0) {
			items.push({ label: 'Branches', kind: vscode.QuickPickItemKind.Separator });
			for (const b of branches) {
				items.push({
					label: `$(git-branch) ${b.name}`,
					description: b.commit?.slice(0, 8) ?? '',
					ref: b.name!,
				});
			}
		}

		const tags = sortRefs(repo.state.refs.filter((r) => r.type === RefType.Tag && !!r.name));
		if (tags.length > 0) {
			items.push({ label: 'Tags', kind: vscode.QuickPickItemKind.Separator });
			for (const t of tags) {
				items.push({
					label: `$(tag) ${t.name}`,
					description: t.commit?.slice(0, 8) ?? '',
					ref: t.name!,
				});
			}
		}

		const remotes = sortRefs(
			repo.state.refs.filter((r) => r.type === RefType.RemoteHead && !!r.name),
		);
		if (remotes.length > 0) {
			items.push({ label: 'Remote branches', kind: vscode.QuickPickItemKind.Separator });
			for (const r of remotes) {
				items.push({
					label: `$(cloud) ${r.name}`,
					description: r.commit?.slice(0, 8) ?? '',
					ref: r.name!,
				});
			}
		}

		const recent = await logRecent(repo.rootUri.fsPath, 30);
		if (recent.length > 0) {
			items.push({ label: 'Recent commits', kind: vscode.QuickPickItemKind.Separator });
			for (const c of recent) {
				items.push({
					label: `$(git-commit) ${c.shortSha}`,
					description: c.subject,
					detail: `${c.authorName} · ${c.authorDate}`,
					ref: c.sha,
				});
			}
		}
	}

	const placeholder = repo
		? `Pick a git ref to diff against (current: ${currentRef ?? 'HEAD'})`
		: 'No git repository detected — enter a ref manually';

	const picked = await vscode.window.showQuickPick(items, {
		placeHolder: placeholder,
		matchOnDescription: true,
		matchOnDetail: true,
	});

	if (!picked) {
		return undefined;
	}
	if (picked.action === 'clear') {
		return { clear: true };
	}
	if (picked.action === 'custom') {
		const typed = await vscode.window.showInputBox({
			prompt: 'Enter a git ref (branch, tag, SHA, or stash)',
			placeHolder: 'e.g. main, v1.2.0, 9f1c2ab, stash@{0}',
			value: currentRef ?? '',
		});
		const trimmed = typed?.trim();
		return trimmed && trimmed.length > 0 ? trimmed : undefined;
	}
	return picked.ref;
}

async function firstRepoFromWorkspace(): Promise<Repository | undefined> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	return folder ? findRepository(folder.uri) : undefined;
}

function sortRefs(refs: Ref[]): Ref[] {
	return [...refs].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}
