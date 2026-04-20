import * as vscode from 'vscode';
import { BaselineStore } from './baseline';
import { relativeTo, showFileAtRef } from './git/cli';

export const TIME_TRAVELLER_SCHEME = 'git-time-traveller';

/**
 * URI shapes for our custom scheme:
 *
 * - **Live-baseline URI** — `git-time-traveller:/abs/path` with *no query*.
 *   Returned by `provideOriginalResource`; its content is resolved against
 *   the current `BaselineStore` at read time. When the store fires
 *   `onDidChange`, we refire for this URI and VS Code re-reads fresh content.
 *
 * - **Explicit-ref URI** — `git-time-traveller:/abs/path?ref=<sha>`.
 *   Used for "Open at revision" / diff-at-commit flows from the history
 *   panel. The ref is pinned in the query and immune to baseline changes.
 */
export function makeTimeTravellerUri(repoRoot: string, relPath: string, ref: string): vscode.Uri {
	const absPath = `${repoRoot}/${relPath.replace(/\\/g, '/')}`;
	return vscode.Uri.from({
		scheme: TIME_TRAVELLER_SCHEME,
		path: absPath,
		query: `ref=${encodeURIComponent(ref)}`,
	});
}

/**
 * Resolve the ref that should populate the given TT URI's content. Pure: takes
 * the URI and a getter into whatever baseline store the caller wants.
 */
export function resolveRefForUri(
	uri: vscode.Uri,
	getBaseline: (fileUri: vscode.Uri) => string | undefined,
): string {
	const queryRef = new URLSearchParams(uri.query).get('ref');
	if (queryRef) return queryRef;
	const fileUri = vscode.Uri.file(uri.with({ scheme: 'file', query: '' }).fsPath);
	return getBaseline(fileUri) ?? 'HEAD';
}

export class TimeTravellerQuickDiff
	implements vscode.QuickDiffProvider, vscode.TextDocumentContentProvider
{
	private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
	readonly onDidChange = this.changeEmitter.event;

	constructor(private readonly baseline: BaselineStore) {
		baseline.onDidChange((change) => {
			for (const doc of vscode.workspace.textDocuments) {
				if (doc.uri.scheme !== TIME_TRAVELLER_SCHEME) continue;
				// Explicit-ref URIs are pinned and immune to baseline changes.
				if (doc.uri.query) continue;
				if (change.scope === 'global') {
					this.changeEmitter.fire(doc.uri);
				} else if (change.uri && change.uri.path === doc.uri.path) {
					this.changeEmitter.fire(doc.uri);
				}
			}
		});
	}

	provideOriginalResource(uri: vscode.Uri): vscode.ProviderResult<vscode.Uri> {
		if (uri.scheme !== 'file') {
			return undefined;
		}
		// Live-baseline URI: no query. Content resolved at read time.
		return uri.with({ scheme: TIME_TRAVELLER_SCHEME, query: '' });
	}

	async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		const absPath = uri.with({ scheme: 'file', query: '' }).fsPath;
		const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(absPath));
		if (!folder) {
			return '';
		}
		const ref = resolveRefForUri(uri, (fileUri) => {
			// Effective ref chain: per-file override → global → configured default.
			// The settings value acts as the workspace's "always-on" baseline for
			// users who e.g. always want to see diffs against `origin/main`.
			const stored = this.baseline.get(fileUri);
			if (stored) return stored;
			return (
				vscode.workspace.getConfiguration('timeTraveller').get<string>('defaultBaseline') ??
				undefined
			);
		});
		const rel = relativeTo(folder.uri.fsPath, absPath);
		return showFileAtRef(folder.uri.fsPath, ref, rel);
	}
}
