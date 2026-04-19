import * as vscode from 'vscode';
import { findRepository, RefType, type Ref, type Repository } from './git/api';
import { logRecent, type RawLogRecord } from './git/cli';

export interface RefPick extends vscode.QuickPickItem {
	ref?: string;
	action?: 'custom' | 'clear';
}

export interface BaselinePickResult {
	kind: 'ref' | 'clear' | 'cancel';
	ref?: string;
}

export function sortRefsByName(refs: Ref[]): Ref[] {
	return [...refs].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

export function buildPresetItems(currentRef: string | undefined): RefPick[] {
	const items: RefPick[] = [
		{ label: 'Presets', kind: vscode.QuickPickItemKind.Separator },
		{ label: '$(git-commit) HEAD', description: 'current branch tip', ref: 'HEAD' },
	];
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
	return items;
}

const REF_SECTION_CONFIG: Record<
	'branch' | 'tag' | 'remote',
	{ title: string; icon: string; type: RefType }
> = {
	branch: { title: 'Branches', icon: '$(git-branch)', type: RefType.Head },
	tag: { title: 'Tags', icon: '$(tag)', type: RefType.Tag },
	remote: { title: 'Remote branches', icon: '$(cloud)', type: RefType.RemoteHead },
};

export function buildRefSection(section: 'branch' | 'tag' | 'remote', refs: Ref[]): RefPick[] {
	const cfg = REF_SECTION_CONFIG[section];
	const matching = sortRefsByName(refs.filter((r) => r.type === cfg.type && !!r.name));
	if (matching.length === 0) return [];
	const items: RefPick[] = [{ label: cfg.title, kind: vscode.QuickPickItemKind.Separator }];
	for (const ref of matching) {
		items.push({
			label: `${cfg.icon} ${ref.name}`,
			description: ref.commit?.slice(0, 8) ?? '',
			ref: ref.name!,
		});
	}
	return items;
}

export function buildCommitSection(records: RawLogRecord[]): RefPick[] {
	if (records.length === 0) return [];
	const items: RefPick[] = [{ label: 'Recent commits', kind: vscode.QuickPickItemKind.Separator }];
	for (const c of records) {
		items.push({
			label: `$(git-commit) ${c.shortSha}`,
			description: c.subject,
			detail: `${c.authorName} · ${c.authorDate}`,
			ref: c.sha,
		});
	}
	return items;
}

export function buildPickItems(input: {
	currentRef: string | undefined;
	refs: Ref[];
	recentCommits: RawLogRecord[];
}): RefPick[] {
	return [
		...buildPresetItems(input.currentRef),
		...buildRefSection('branch', input.refs),
		...buildRefSection('tag', input.refs),
		...buildRefSection('remote', input.refs),
		...buildCommitSection(input.recentCommits),
	];
}

export async function pickBaselineRef(currentRef: string | undefined): Promise<BaselinePickResult> {
	const activeUri = vscode.window.activeTextEditor?.document.uri;
	const repo = await (activeUri ? findRepository(activeUri) : firstRepoFromWorkspace());

	const recentCommits = repo ? await logRecent(repo.rootUri.fsPath, 30) : [];
	const items = buildPickItems({
		currentRef,
		refs: repo?.state.refs ?? [],
		recentCommits,
	});

	const placeholder = repo
		? `Pick a git ref to diff against (current: ${currentRef ?? 'HEAD'})`
		: 'No git repository detected — enter a ref manually';

	const picked = await vscode.window.showQuickPick(items, {
		placeHolder: placeholder,
		matchOnDescription: true,
		matchOnDetail: true,
	});

	if (!picked) return { kind: 'cancel' };
	if (picked.action === 'clear') return { kind: 'clear' };
	if (picked.action === 'custom') {
		const typed = await vscode.window.showInputBox({
			prompt: 'Enter a git ref (branch, tag, SHA, or stash)',
			placeHolder: 'e.g. main, v1.2.0, 9f1c2ab, stash@{0}',
			value: currentRef ?? '',
		});
		const trimmed = typed?.trim();
		return trimmed && trimmed.length > 0 ? { kind: 'ref', ref: trimmed } : { kind: 'cancel' };
	}
	return picked.ref ? { kind: 'ref', ref: picked.ref } : { kind: 'cancel' };
}

async function firstRepoFromWorkspace(): Promise<Repository | undefined> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	return folder ? findRepository(folder.uri) : undefined;
}
