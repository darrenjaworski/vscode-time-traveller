import * as vscode from 'vscode';
import { findRepository, RefType, type Ref, type Repository } from './git/api';
import { getMergeBase, logRecent, type RawLogRecord } from './git/cli';

export interface RefPick extends vscode.QuickPickItem {
	ref?: string;
	action?: 'custom' | 'clear' | 'merge-base';
	mergeBaseTarget?: string;
}

export interface BaselinePickResult {
	kind: 'ref' | 'clear' | 'cancel';
	ref?: string;
}

/** Common default-branch names we'll offer a "merge base with…" preset for. */
export const DEFAULT_BRANCH_CANDIDATES = ['main', 'master', 'develop', 'trunk'] as const;

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

/**
 * Given the repo's refs and the current HEAD branch name, return default-branch
 * targets (local preferred, falling back to `origin/<name>`) that aren't the
 * current branch itself. Used to build the "Merge base with …" presets.
 */
export function detectMergeBaseCandidates(
	refs: Ref[],
	currentBranch: string | undefined,
): string[] {
	const branchNames = new Set(
		refs.filter((r) => r.type === RefType.Head && r.name).map((r) => r.name!),
	);
	const remoteNames = new Set(
		refs.filter((r) => r.type === RefType.RemoteHead && r.name).map((r) => r.name!),
	);
	const out: string[] = [];
	for (const name of DEFAULT_BRANCH_CANDIDATES) {
		if (name === currentBranch) continue;
		if (branchNames.has(name)) {
			out.push(name);
		} else if (remoteNames.has(`origin/${name}`)) {
			out.push(`origin/${name}`);
		}
	}
	return out;
}

export function buildMergeBasePresets(candidates: string[]): RefPick[] {
	if (candidates.length === 0) return [];
	return [
		{ label: 'Scopes', kind: vscode.QuickPickItemKind.Separator },
		...candidates.map<RefPick>((target) => ({
			label: `$(git-merge) Merge base with ${target}`,
			description: 'fork point for PR-style diff',
			action: 'merge-base',
			mergeBaseTarget: target,
		})),
	];
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
	mergeBaseCandidates: string[];
}): RefPick[] {
	return [
		...buildPresetItems(input.currentRef),
		...buildMergeBasePresets(input.mergeBaseCandidates),
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
	const mergeBaseCandidates = repo
		? detectMergeBaseCandidates(repo.state.refs, repo.state.HEAD?.name)
		: [];
	const items = buildPickItems({
		currentRef,
		refs: repo?.state.refs ?? [],
		recentCommits,
		mergeBaseCandidates,
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
	if (picked.action === 'merge-base' && picked.mergeBaseTarget && repo) {
		const sha = await getMergeBase(repo.rootUri.fsPath, 'HEAD', picked.mergeBaseTarget);
		if (!sha) {
			vscode.window.showWarningMessage(
				`Could not compute merge-base between HEAD and ${picked.mergeBaseTarget}.`,
			);
			return { kind: 'cancel' };
		}
		return { kind: 'ref', ref: sha };
	}
	return picked.ref ? { kind: 'ref', ref: picked.ref } : { kind: 'cancel' };
}

async function firstRepoFromWorkspace(): Promise<Repository | undefined> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	return folder ? findRepository(folder.uri) : undefined;
}
