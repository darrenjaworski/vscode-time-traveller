import * as vscode from 'vscode';
import { BaselineStore } from './baseline';
import { findRepository } from './git/api';
import { logFile, relativeTo } from './git/cli';
import { makeTimeTravellerUri } from './quickDiff';
import { computeStep, shortLabel, type StepDirection } from './stepping';

const STEP_LOG_LIMIT = 500;

/**
 * Move the active file's baseline by one commit along its `git log --follow`.
 * Writes to the per-file slot of `BaselineStore` — stepping is always a
 * file-scoped action.
 */
export async function stepBaseline(
	baseline: BaselineStore,
	direction: StepDirection,
): Promise<void> {
	const uri = vscode.window.activeTextEditor?.document.uri;
	if (!uri || uri.scheme !== 'file') {
		vscode.window.setStatusBarMessage('Open a file to step its baseline.', 2500);
		return;
	}
	const repo = await findRepository(uri);
	if (!repo) {
		vscode.window.setStatusBarMessage('No git repository for this file.', 2500);
		return;
	}
	const relPath = relativeTo(repo.rootUri.fsPath, uri.fsPath);
	const records = await logFile(repo.rootUri.fsPath, relPath, STEP_LOG_LIMIT);
	const next = computeStep(records, baseline.get(uri), direction);
	if (!next) {
		vscode.window.setStatusBarMessage(
			direction === 'back'
				? 'Already at the oldest revision of this file.'
				: 'Already at the newest revision of this file.',
			2500,
		);
		return;
	}
	await baseline.setForFile(uri, next.sha);
}

/**
 * Open a side-by-side diff editor between the current file and its effective
 * baseline (per-file override, or global, or HEAD).
 */
export async function openDiffWithBaseline(baseline: BaselineStore): Promise<void> {
	const uri = vscode.window.activeTextEditor?.document.uri;
	if (!uri || uri.scheme !== 'file') {
		vscode.window.setStatusBarMessage('Open a file to diff against its baseline.', 2500);
		return;
	}
	const folder = vscode.workspace.getWorkspaceFolder(uri);
	if (!folder) {
		vscode.window.setStatusBarMessage('File is not inside an open workspace folder.', 2500);
		return;
	}
	const ref = baseline.get(uri) ?? 'HEAD';
	const rel = relativeTo(folder.uri.fsPath, uri.fsPath);
	const left = makeTimeTravellerUri(folder.uri.fsPath, rel, ref);
	const title = `${rel} (${shortLabel(ref)}) ↔ Working Tree`;
	await vscode.commands.executeCommand('vscode.diff', left, uri, title);
}
