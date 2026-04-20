import * as vscode from 'vscode';
import type { BaselineStore } from './baseline';
import { parseDiffHunks, type Hunk } from './diff';
import { findRepository } from './git/api';
import { blameRange, getFileDiff, relativeTo, type BlameLine } from './git/cli';
import { escapeMarkdown } from './history/provider';

const HOVER_SETTING = 'timeTraveller.hover.enabled';

/**
 * Whether the hunk list "owns" the given 1-based line. Only hunks whose *new*
 * side contains content (`newCount > 0`) count — pure-delete hunks have
 * `newCount === 0` and there's nothing to hover on. Exported for tests.
 */
export function hunksContainLine(hunks: Hunk[], line1Based: number): boolean {
	for (const h of hunks) {
		if (h.newCount === 0) continue;
		const start = h.newStart;
		const end = h.newStart + h.newCount - 1;
		if (line1Based >= start && line1Based <= end) return true;
	}
	return false;
}

/**
 * Format the blame result as a hover-ready markdown string. Pure: the
 * `ChangeHoverProvider` wraps this in a `vscode.MarkdownString` for dispatch.
 */
export function buildHoverMarkdown(line: BlameLine): string {
	const date = new Date(line.authorTime * 1000).toISOString().slice(0, 10);
	const header = `**${escapeMarkdown(line.summary || '(no subject)')}**`;
	const meta = `\`${line.sha.slice(0, 7)}\` · ${escapeMarkdown(line.author || 'unknown')}${
		line.authorEmail ? ` <${escapeMarkdown(line.authorEmail)}>` : ''
	} · ${date}`;
	return `${header}\n\n${meta}`;
}

/**
 * Shows a hover with the commit that last touched the current line — but only
 * on lines that are *changed* relative to the current baseline. The scope
 * makes the hover feel intentional rather than noisy: you get it exactly
 * where the gutter already draws attention.
 */
export class ChangeHoverProvider implements vscode.HoverProvider {
	/** Per-document cache keyed by URI string. Invalidated on baseline change
	 * or when the document's version number advances (edits, save). Keeps us
	 * from shelling `git diff` on every mouse rest. */
	private readonly cache = new Map<string, { ref: string; version: number; hunks: Hunk[] }>();

	constructor(private readonly baseline: BaselineStore) {
		baseline.onDidChange(() => this.cache.clear());
	}

	async provideHover(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken,
	): Promise<vscode.Hover | undefined> {
		if (!isEnabled()) return undefined;
		if (document.uri.scheme !== 'file') return undefined;

		const repo = await findRepository(document.uri);
		if (!repo) return undefined;

		const relPath = relativeTo(repo.rootUri.fsPath, document.uri.fsPath);
		if (!relPath || relPath.startsWith('..')) return undefined;

		const ref = this.effectiveRef(document.uri);
		const hunks = await this.hunksFor(document, ref, repo.rootUri.fsPath, relPath);
		const line1Based = position.line + 1;
		if (!hunksContainLine(hunks, line1Based)) return undefined;

		const [blameLine] = await blameRange(repo.rootUri.fsPath, relPath, line1Based, line1Based);
		if (!blameLine) return undefined;

		const md = new vscode.MarkdownString(buildHoverMarkdown(blameLine));
		md.isTrusted = false;
		md.supportThemeIcons = true;
		return new vscode.Hover(md);
	}

	private effectiveRef(uri: vscode.Uri): string {
		return (
			this.baseline.get(uri) ??
			vscode.workspace.getConfiguration('timeTraveller').get<string>('defaultBaseline') ??
			'HEAD'
		);
	}

	private async hunksFor(
		document: vscode.TextDocument,
		ref: string,
		repoRoot: string,
		relPath: string,
	): Promise<Hunk[]> {
		const key = document.uri.toString();
		const existing = this.cache.get(key);
		if (existing && existing.ref === ref && existing.version === document.version) {
			return existing.hunks;
		}
		const diff = await getFileDiff(repoRoot, ref, relPath);
		const hunks = parseDiffHunks(diff);
		this.cache.set(key, { ref, version: document.version, hunks });
		return hunks;
	}
}

function isEnabled(): boolean {
	return vscode.workspace.getConfiguration().get<boolean>(HOVER_SETTING, true);
}

export function registerChangeHover(baseline: BaselineStore): vscode.Disposable {
	const provider = new ChangeHoverProvider(baseline);
	return vscode.languages.registerHoverProvider({ scheme: 'file' }, provider);
}
