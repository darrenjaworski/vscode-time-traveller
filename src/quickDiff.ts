import * as vscode from 'vscode';
import { BaselineStore } from './baseline';
import { relativeTo, showFileAtRef } from './git';

export const TIME_TRAVELLER_SCHEME = 'git-time-traveller';

export class TimeTravellerQuickDiff
	implements vscode.QuickDiffProvider, vscode.TextDocumentContentProvider
{
	private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
	readonly onDidChange = this.changeEmitter.event;

	constructor(private readonly baseline: BaselineStore) {
		baseline.onDidChange(() => {
			for (const doc of vscode.workspace.textDocuments) {
				if (doc.uri.scheme === TIME_TRAVELLER_SCHEME) {
					this.changeEmitter.fire(doc.uri);
				}
			}
		});
	}

	provideOriginalResource(uri: vscode.Uri): vscode.ProviderResult<vscode.Uri> {
		if (uri.scheme !== 'file') {
			return undefined;
		}
		const ref = this.baseline.get() ?? 'HEAD';
		return uri.with({
			scheme: TIME_TRAVELLER_SCHEME,
			path: uri.path,
			query: `ref=${encodeURIComponent(ref)}`,
		});
	}

	async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		const ref = new URLSearchParams(uri.query).get('ref') ?? 'HEAD';
		const absPath = uri.with({ scheme: 'file', query: '' }).fsPath;
		const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(absPath));
		if (!folder) {
			return '';
		}
		const rel = relativeTo(folder.uri.fsPath, absPath);
		return showFileAtRef(folder.uri.fsPath, ref, rel);
	}
}
