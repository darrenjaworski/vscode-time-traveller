import * as vscode from 'vscode';
import type { BaselineStore } from './baseline';
import { codeLensLineForHunk, parseDiffHunks, type Hunk } from './diff';
import { findRepository } from './git/api';
import { getFileDiff, relativeTo } from './git/cli';

const CODE_LENS_SETTING = 'timeTraveller.codeLens.enabled';

/**
 * Emits an "Ask @historian why this changed" CodeLens above each hunk in the
 * active file's diff against the current baseline. Kept thin: the hunk
 * parsing lives in `src/diff.ts` as a pure helper, and the follow-up
 * command (`timeTraveller.askHistorianForHunk`) is registered below so
 * callers can wire both in one call.
 */
export class HunkCodeLensProvider implements vscode.CodeLensProvider {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeCodeLenses = this.changeEmitter.event;

	constructor(private readonly baseline: BaselineStore) {
		baseline.onDidChange(() => this.changeEmitter.fire());
	}

	refresh(): void {
		this.changeEmitter.fire();
	}

	async provideCodeLenses(
		document: vscode.TextDocument,
		_token: vscode.CancellationToken,
	): Promise<vscode.CodeLens[]> {
		if (!isEnabled()) return [];
		if (document.uri.scheme !== 'file') return [];

		const repo = await findRepository(document.uri);
		if (!repo) return [];

		const relPath = relativeTo(repo.rootUri.fsPath, document.uri.fsPath);
		if (!relPath || relPath.startsWith('..')) return [];

		const ref =
			this.baseline.get(document.uri) ??
			vscode.workspace.getConfiguration('timeTraveller').get<string>('defaultBaseline') ??
			'HEAD';

		const diffText = await getFileDiff(repo.rootUri.fsPath, ref, relPath);
		if (!diffText) return [];

		return parseDiffHunks(diffText).map((hunk) => makeLens(document.uri, hunk, ref));
	}
}

function makeLens(uri: vscode.Uri, hunk: Hunk, ref: string): vscode.CodeLens {
	const line = codeLensLineForHunk(hunk);
	const range = new vscode.Range(line, 0, line, 0);
	return new vscode.CodeLens(range, {
		title: '$(comment-discussion) Ask @historian why this changed',
		command: 'timeTraveller.askHistorianForHunk',
		tooltip: `Open @historian focused on this hunk (baseline: ${ref}).`,
		arguments: [uri, hunk],
	});
}

function isEnabled(): boolean {
	return vscode.workspace.getConfiguration().get<boolean>(CODE_LENS_SETTING, true);
}

/**
 * Registers both the CodeLens provider and the `askHistorianForHunk` command
 * it invokes. Exposed as a single call so `extension.ts` stays skimmable.
 */
export function registerHunkCodeLens(baseline: BaselineStore): vscode.Disposable {
	const provider = new HunkCodeLensProvider(baseline);
	const disposables: vscode.Disposable[] = [];

	disposables.push(
		vscode.languages.registerCodeLensProvider({ scheme: 'file' }, provider),

		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration(CODE_LENS_SETTING)) provider.refresh();
		}),

		vscode.workspace.onDidSaveTextDocument(() => provider.refresh()),

		vscode.commands.registerCommand(
			'timeTraveller.askHistorianForHunk',
			async (uri: vscode.Uri, hunk: Hunk) => {
				if (!uri || !hunk) return;
				const editor = await vscode.window.showTextDocument(uri);
				// Select the hunk's lines so the @historian handler's
				// selection-scoped path picks them up — no special chat-side
				// wiring needed.
				const startLine = codeLensLineForHunk(hunk);
				const endLine = Math.max(startLine, startLine + Math.max(hunk.newCount, 1) - 1);
				editor.selection = new vscode.Selection(startLine, 0, endLine, Number.MAX_SAFE_INTEGER);
				editor.revealRange(editor.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
				await vscode.commands.executeCommand('workbench.action.chat.open', {
					query: '@historian why is this the way it is?',
				});
			},
		),
	);

	return vscode.Disposable.from(...disposables);
}
