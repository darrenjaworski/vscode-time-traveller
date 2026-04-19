import * as vscode from 'vscode';

const GLOBAL_KEY = 'timeTraveller.baselineRef';
const FILE_MAP_KEY = 'timeTraveller.baselineRefsByFile';

export interface BaselineChange {
	scope: 'global' | 'file';
	uri?: vscode.Uri;
	ref: string | undefined;
}

/**
 * Single source of truth for the user's diff baseline.
 *
 * Two scopes:
 * - **Global** — a workspace-wide ref used when no per-file override exists.
 * - **Per-file** — a URI-keyed override that shadows the global for that file.
 *
 * Callers should prefer `get(uri)` so the override is transparently applied.
 * The store only emits `onDidChange` for what actually changed, so consumers
 * (QuickDiff, history panel, status bar) can target their refreshes.
 */
export class BaselineStore {
	private readonly emitter = new vscode.EventEmitter<BaselineChange>();
	readonly onDidChange = this.emitter.event;

	constructor(private readonly memento: vscode.Memento) {}

	/** Effective ref: per-file override if set, else global, else undefined. */
	get(uri?: vscode.Uri): string | undefined {
		if (uri) {
			const fileRef = this.getForFile(uri);
			if (fileRef) return fileRef;
		}
		return this.getGlobal();
	}

	getGlobal(): string | undefined {
		const value = this.memento.get<string>(GLOBAL_KEY);
		return value && value.length > 0 ? value : undefined;
	}

	getForFile(uri: vscode.Uri): string | undefined {
		const value = this.getFileMap()[uri.toString()];
		return value && value.length > 0 ? value : undefined;
	}

	hasFileOverride(uri: vscode.Uri): boolean {
		return this.getForFile(uri) !== undefined;
	}

	/** Set the workspace-wide (global) baseline. Does not affect per-file overrides. */
	async set(ref: string | undefined): Promise<void> {
		await this.memento.update(GLOBAL_KEY, ref);
		this.emitter.fire({ scope: 'global', ref });
	}

	/** Set (or clear, when `ref` is undefined/empty) the per-file baseline. */
	async setForFile(uri: vscode.Uri, ref: string | undefined): Promise<void> {
		const map = { ...this.getFileMap() };
		const key = uri.toString();
		if (!ref) {
			delete map[key];
		} else {
			map[key] = ref;
		}
		await this.memento.update(FILE_MAP_KEY, map);
		this.emitter.fire({ scope: 'file', uri, ref: ref || undefined });
	}

	clearForFile(uri: vscode.Uri): Promise<void> {
		return this.setForFile(uri, undefined);
	}

	private getFileMap(): Record<string, string> {
		return this.memento.get<Record<string, string>>(FILE_MAP_KEY) ?? {};
	}
}
