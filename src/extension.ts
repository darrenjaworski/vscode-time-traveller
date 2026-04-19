import * as vscode from 'vscode';
import { BaselineStore } from './baseline';
import { TimeTravellerQuickDiff, TIME_TRAVELLER_SCHEME } from './quickDiff';
import { registerBlameParticipant } from './chat';

export function activate(context: vscode.ExtensionContext): void {
	const baseline = new BaselineStore(context.workspaceState);

	const quickDiff = new TimeTravellerQuickDiff(baseline);
	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider(TIME_TRAVELLER_SCHEME, quickDiff),
	);

	const scm = vscode.scm.createSourceControl(
		'timeTraveller',
		'Time Traveller',
		vscode.workspace.workspaceFolders?.[0]?.uri,
	);
	scm.quickDiffProvider = quickDiff;
	context.subscriptions.push(scm);

	const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
	statusItem.command = 'timeTraveller.pickBaseline';
	const refreshStatus = () => {
		const ref = baseline.get();
		statusItem.text = ref ? `$(git-commit) baseline: ${ref}` : '$(git-commit) baseline: HEAD';
		statusItem.tooltip = 'Click to pick a different git ref as the quick-diff baseline.';
		statusItem.show();
	};
	refreshStatus();
	context.subscriptions.push(statusItem, baseline.onDidChange(refreshStatus));

	context.subscriptions.push(
		vscode.commands.registerCommand('timeTraveller.pickBaseline', async () => {
			const picked = await vscode.window.showInputBox({
				prompt: 'Pick a git ref (branch, tag, SHA, or stash) to diff against',
				placeHolder: 'e.g. main, v1.2.0, 9f1c2ab, stash@{0}',
				value: baseline.get() ?? '',
			});
			if (picked !== undefined) {
				await baseline.set(picked.trim() || undefined);
			}
		}),
		vscode.commands.registerCommand('timeTraveller.clearBaseline', async () => {
			await baseline.set(undefined);
		}),
		vscode.commands.registerCommand('timeTraveller.showCurrentBaseline', () => {
			const ref = baseline.get();
			vscode.window.showInformationMessage(`Time Traveller baseline: ${ref ?? 'HEAD'}`);
		}),
	);

	context.subscriptions.push(registerBlameParticipant(baseline));
}

export function deactivate(): void {
	/* noop */
}
