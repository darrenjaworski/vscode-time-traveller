import * as vscode from 'vscode';

export enum RefType {
	Head = 0,
	RemoteHead = 1,
	Tag = 2,
}

export interface Ref {
	readonly type: RefType;
	readonly name?: string;
	readonly commit?: string;
	readonly remote?: string;
}

export interface Branch extends Ref {
	readonly upstream?: { name: string; remote: string };
	readonly ahead?: number;
	readonly behind?: number;
}

export interface RepositoryState {
	readonly HEAD: Branch | undefined;
	readonly refs: Ref[];
	readonly onDidChange: vscode.Event<void>;
}

export interface Commit {
	readonly hash: string;
	readonly message: string;
	readonly parents: string[];
	readonly authorDate?: Date;
	readonly authorName?: string;
	readonly authorEmail?: string;
}

export interface Repository {
	readonly rootUri: vscode.Uri;
	readonly state: RepositoryState;
	getBranches(query: { remote?: boolean; count?: number }): Promise<Ref[]>;
	log?(options?: { maxEntries?: number; path?: string }): Promise<Commit[]>;
	getCommit?(ref: string): Promise<Commit>;
}

export interface GitAPI {
	readonly repositories: Repository[];
	readonly onDidOpenRepository: vscode.Event<Repository>;
	readonly onDidCloseRepository: vscode.Event<Repository>;
}

interface GitExtension {
	readonly enabled: boolean;
	getAPI(version: 1): GitAPI;
}

let cached: GitAPI | undefined;

export async function getGitAPI(): Promise<GitAPI | undefined> {
	if (cached) {
		return cached;
	}
	const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
	if (!ext) {
		return undefined;
	}
	if (!ext.isActive) {
		await ext.activate();
	}
	if (!ext.exports.enabled) {
		return undefined;
	}
	cached = ext.exports.getAPI(1);
	return cached;
}

export async function findRepository(uri: vscode.Uri): Promise<Repository | undefined> {
	const api = await getGitAPI();
	if (!api) {
		return undefined;
	}
	let best: Repository | undefined;
	let bestLength = -1;
	const target = uri.fsPath;
	for (const repo of api.repositories) {
		const root = repo.rootUri.fsPath;
		if (target === root || target.startsWith(root + '/') || target.startsWith(root + '\\')) {
			if (root.length > bestLength) {
				best = repo;
				bestLength = root.length;
			}
		}
	}
	return best;
}
