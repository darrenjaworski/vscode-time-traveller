import * as vscode from 'vscode';
import { BaselineStore } from './baseline';
import { pickBaselineRef } from './baselinePicker';
import { registerHistorianParticipant } from './chat';
import { registerChatVariables } from './chatVariables';
import { registerHunkCodeLens } from './codeLens';
import { registerHistoryView } from './history/view';
import { registerChangeHover } from './hover';
import { openDiffWithBaseline, stepBaseline } from './multiBaseline';
import { TimeTravellerQuickDiff, TIME_TRAVELLER_SCHEME } from './quickDiff';
import { registerTools } from './tools/register';

export function activate(context: vscode.ExtensionContext): void {
	const baseline = new BaselineStore(context.workspaceState);

	context.subscriptions.push(...registerChatVariables(baseline));

	const quickDiff = new TimeTravellerQuickDiff(baseline);
	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider(TIME_TRAVELLER_SCHEME, quickDiff),
	);

	// This SourceControl exists solely to carry `quickDiffProvider` — the VS
	// Code API has no standalone registration for quick diff. We never push
	// resources into it, so the row in the SCM view is just a label.
	const scm = vscode.scm.createSourceControl(
		'timeTraveller',
		'Time Traveller (baseline)',
		vscode.workspace.workspaceFolders?.[0]?.uri,
	);
	scm.quickDiffProvider = quickDiff;
	context.subscriptions.push(scm);

	const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
	statusItem.command = 'timeTraveller.pickBaseline';
	const refreshStatus = () => {
		const activeUri = vscode.window.activeTextEditor?.document.uri;
		const inFile = activeUri?.scheme === 'file';
		const ref = inFile ? baseline.get(activeUri) : baseline.getGlobal();
		const perFile = inFile && baseline.hasFileOverride(activeUri);
		const label = ref ? formatRefForStatus(ref) : 'HEAD';
		statusItem.text = `$(git-commit) baseline: ${label}${perFile ? ' (file)' : ''}`;
		statusItem.tooltip = perFile
			? 'Per-file baseline for this document. Click to change.'
			: 'Workspace baseline. Click to change.';
		statusItem.show();
	};
	refreshStatus();
	context.subscriptions.push(
		statusItem,
		baseline.onDidChange(refreshStatus),
		vscode.window.onDidChangeActiveTextEditor(refreshStatus),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('timeTraveller.pickBaseline', async () => {
			const result = await pickBaselineRef(baseline.getGlobal());
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
			const activeUri = vscode.window.activeTextEditor?.document.uri;
			const inFile = activeUri?.scheme === 'file';
			const effective = inFile ? baseline.get(activeUri) : baseline.getGlobal();
			const perFile = inFile && baseline.hasFileOverride(activeUri);
			vscode.window.showInformationMessage(
				`Time Traveller baseline: ${effective ?? 'HEAD'}${perFile ? ' (per-file)' : ''}`,
			);
		}),
		vscode.commands.registerCommand('timeTraveller.pickBaselineForFile', async () => {
			const uri = vscode.window.activeTextEditor?.document.uri;
			if (!uri || uri.scheme !== 'file') {
				vscode.window.showInformationMessage('Open a file to set a per-file baseline.');
				return;
			}
			const result = await pickBaselineRef(baseline.getForFile(uri));
			if (result.kind === 'cancel') return;
			if (result.kind === 'clear') {
				await baseline.clearForFile(uri);
				return;
			}
			await baseline.setForFile(uri, result.ref);
		}),
		vscode.commands.registerCommand('timeTraveller.clearBaselineForFile', async () => {
			const uri = vscode.window.activeTextEditor?.document.uri;
			if (!uri || uri.scheme !== 'file') return;
			await baseline.clearForFile(uri);
		}),
		vscode.commands.registerCommand('timeTraveller.stepBaselineBackward', () =>
			stepBaseline(baseline, 'back'),
		),
		vscode.commands.registerCommand('timeTraveller.stepBaselineForward', () =>
			stepBaseline(baseline, 'forward'),
		),
		vscode.commands.registerCommand('timeTraveller.openDiffWithBaseline', () =>
			openDiffWithBaseline(baseline),
		),
		vscode.commands.registerCommand('timeTraveller.walkthroughs.askHistorian', async () => {
			await vscode.commands.executeCommand('workbench.action.chat.open', {
				query: '@historian /story',
			});
		}),
		vscode.commands.registerCommand('timeTraveller.signInToGitHub', async () => {
			try {
				const session = await vscode.authentication.getSession('github', ['repo'], {
					createIfNone: true,
				});
				if (session) {
					vscode.window.showInformationMessage(
						`Signed in to GitHub as ${session.account.label}. @historian will now fetch PR context.`,
					);
				}
			} catch (err) {
				vscode.window.showErrorMessage(`GitHub sign-in failed: ${(err as Error).message ?? err}`);
			}
		}),
	);

	context.subscriptions.push(registerHistoryView(baseline, context.workspaceState));
	context.subscriptions.push(registerHunkCodeLens(baseline));
	context.subscriptions.push(registerChangeHover(baseline));
	context.subscriptions.push(registerHistorianParticipant(baseline));

	const editor = vscode.window.activeTextEditor;
	if (editor) {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
		if (workspaceFolder) {
			context.subscriptions.push(...registerTools(workspaceFolder.uri.fsPath));
		}
	}
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
