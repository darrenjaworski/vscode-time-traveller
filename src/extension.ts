import * as vscode from 'vscode';
import { BaselineStore } from './baseline';
import { pickBaselineRef } from './baselinePicker';
import { registerBlameParticipant } from './chat';
import { registerHistoryView } from './history/view';
import { TimeTravellerQuickDiff, TIME_TRAVELLER_SCHEME } from './quickDiff';

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
		const label = ref ? formatRefForStatus(ref) : 'HEAD';
		statusItem.text = `$(git-commit) baseline: ${label}`;
		statusItem.tooltip = 'Click to pick a different git ref as the quick-diff baseline.';
		statusItem.show();
	};
	refreshStatus();
	context.subscriptions.push(statusItem, baseline.onDidChange(refreshStatus));

	context.subscriptions.push(
		vscode.commands.registerCommand('timeTraveller.pickBaseline', async () => {
			const result = await pickBaselineRef(baseline.get());
			if (result.kind === 'cancel') return;
			if (result.kind === 'clear') {
				await baseline.set(undefined);
				return;
			}
			await baseline.set(result.ref);
		}),
		vscode.commands.registerCommand('timeTraveller.clearBaseline', async () => {
			await baseline.set(undefined);
		}),
		vscode.commands.registerCommand('timeTraveller.showCurrentBaseline', () => {
			const ref = baseline.get();
			vscode.window.showInformationMessage(`Time Traveller baseline: ${ref ?? 'HEAD'}`);
		}),
	);

	context.subscriptions.push(registerHistoryView(baseline));
	context.subscriptions.push(registerBlameParticipant(baseline));
}

export function deactivate(): void {
	/* noop */
}

export function formatRefForStatus(ref: string): string {
	if (/^[0-9a-f]{40}$/i.test(ref)) {
		return ref.slice(0, 8);
	}
	return ref.length > 24 ? `${ref.slice(0, 22)}…` : ref;
}
