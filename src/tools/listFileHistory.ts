import * as vscode from 'vscode';
import type { RawLogRecord } from '../git/cli';

export interface ListFileHistoryInput {
	relPath: string;
	since?: string;
	author?: string;
	limit?: number;
}

export interface ListFileHistoryDeps {
	repoRoot: string;
	logFile: (repoRoot: string, relPath: string, limit: number) => Promise<RawLogRecord[]>;
	logFileSince?: (
		repoRoot: string,
		relPath: string,
		ref: string,
		limit: number,
	) => Promise<RawLogRecord[]>;
	logFileByAuthor?: (
		repoRoot: string,
		relPath: string,
		authorPattern: string,
		limit: number,
	) => Promise<RawLogRecord[]>;
}

export class ListFileHistoryTool implements vscode.LanguageModelTool<ListFileHistoryInput> {
	constructor(private readonly deps: ListFileHistoryDeps) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<ListFileHistoryInput>,
	): Promise<vscode.LanguageModelToolResult> {
		const limit = options.input.limit ?? 20;

		let records: RawLogRecord[];

		if (options.input.author && this.deps.logFileByAuthor) {
			records = await this.deps.logFileByAuthor(
				this.deps.repoRoot,
				options.input.relPath,
				options.input.author,
				limit,
			);
		} else if (options.input.since && this.deps.logFileSince) {
			records = await this.deps.logFileSince(
				this.deps.repoRoot,
				options.input.relPath,
				options.input.since,
				limit,
			);
		} else {
			records = await this.deps.logFile(this.deps.repoRoot, options.input.relPath, limit);
		}

		if (records.length === 0) {
			return new vscode.LanguageModelToolResult([
				new vscode.LanguageModelTextPart('No commits found for this file.'),
			]);
		}

		const lines: string[] = [];
		for (const record of records) {
			const date = new Date(record.authorDate).toLocaleDateString();
			lines.push(`${record.shortSha} ${record.subject} — ${record.authorName} (${date})`);
		}

		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(lines.join('\n'))]);
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<ListFileHistoryInput>,
	): Promise<vscode.PreparedToolInvocation> {
		let msg = `Reading history for ${options.input.relPath}`;
		if (options.input.author) msg += ` by ${options.input.author}`;
		if (options.input.since) msg += ` since ${options.input.since}`;
		msg += '…';
		return { invocationMessage: msg };
	}
}
