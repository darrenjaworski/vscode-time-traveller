import * as vscode from 'vscode';

declare module 'vscode' {
	enum ChatVariableLevel {
		Short = 1,
		Medium = 2,
		Full = 3,
	}

	interface ChatVariableResolver {
		resolve(): ChatVariableValue[] | Thenable<ChatVariableValue[]>;
	}

	interface ChatVariableValue {
		level: ChatVariableLevel;
		value: string;
	}

	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace chat {
		function registerChatVariableResolver(
			id: string,
			name: string,
			description: string,
			fullDescription: string,
			canBeInvokedMultipleTimes: boolean,
			resolver: ChatVariableResolver,
			userMessage: string,
		): Disposable;
	}
}

export interface CommitForVariable {
	shortSha: string;
	subject: string;
	authorName: string;
	authorDate: Date;
	body?: string;
}

export function formatBaselineValue(ref: string | undefined): string {
	return ref ? `Current diff baseline: \`${ref}\`` : 'No diff baseline set (defaults to HEAD)';
}

export function formatHistoryValue(relPath: string, commits: CommitForVariable[]): string {
	if (commits.length === 0) {
		return `No commits found for ${relPath}.`;
	}
	const lines = commits.map(
		(c) =>
			`- \`${c.shortSha}\` · ${c.authorName} · ${c.authorDate.toISOString().slice(0, 10)} — ${c.subject}`,
	);
	return [`Recent commits for ${relPath}:`, ...lines].join('\n');
}

export function formatCommitValue(commit: CommitForVariable | undefined): string {
	if (!commit) return 'No commit selected in the History panel';
	const head = `\`${commit.shortSha}\` · ${commit.authorName} · ${commit.authorDate.toISOString().slice(0, 10)} — ${commit.subject}`;
	return commit.body ? `${head}\n\n${commit.body}` : head;
}

import type { BaselineStore } from './baseline';
import { findRepository } from './git/api';
import { logFile, relativeTo } from './git/cli';

export function registerChatVariables(baseline: BaselineStore): vscode.Disposable[] {
	const resolveBaseline = vscode.chat.registerChatVariableResolver(
		'timeTraveller.baseline',
		'timeTraveller.baseline',
		'The current diff baseline ref',
		'The git ref the gutter is diffing against',
		false,
		{
			resolve: () => {
				const editor = vscode.window.activeTextEditor;
				const ref = editor ? baseline.get(editor.document.uri) : baseline.get(undefined);
				return [{ level: vscode.ChatVariableLevel.Full, value: formatBaselineValue(ref) }];
			},
		},
		'Time Traveller baseline',
	);

	const resolveHistory = vscode.chat.registerChatVariableResolver(
		'timeTraveller.history',
		'timeTraveller.history',
		'Recent commits on the active file',
		'Top 10 commits from `git log --follow` on the active editor',
		false,
		{
			resolve: async () => {
				const editor = vscode.window.activeTextEditor;
				if (!editor || editor.document.uri.scheme !== 'file') {
					return [
						{
							level: vscode.ChatVariableLevel.Full,
							value: 'No active file to read history from',
						},
					];
				}
				const repo = await findRepository(editor.document.uri);
				if (!repo) {
					return [
						{ level: vscode.ChatVariableLevel.Full, value: 'Active file is not in a git repo' },
					];
				}
				const repoRoot = repo.rootUri.fsPath;
				const relPath = relativeTo(repoRoot, editor.document.uri.fsPath);
				if (!relPath) {
					return [
						{ level: vscode.ChatVariableLevel.Full, value: 'Active file is not in a git repo' },
					];
				}
				const records = await logFile(repoRoot, relPath, 10);
				const commits = records.map((r) => ({
					shortSha: r.shortSha,
					subject: r.subject,
					authorName: r.authorName,
					authorDate: new Date(r.authorDate),
				}));
				return [
					{ level: vscode.ChatVariableLevel.Full, value: formatHistoryValue(relPath, commits) },
				];
			},
		},
		'Time Traveller history',
	);

	const resolveCommit = vscode.chat.registerChatVariableResolver(
		'timeTraveller.commit',
		'timeTraveller.commit',
		'The currently selected History panel commit',
		'The commit currently focused in the Time Traveller File History view',
		false,
		{
			resolve: () => [
				{ level: vscode.ChatVariableLevel.Full, value: formatCommitValue(undefined) },
			],
		},
		'Time Traveller commit',
	);

	return [resolveBaseline, resolveHistory, resolveCommit];
}
