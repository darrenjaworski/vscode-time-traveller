import * as vscode from 'vscode';
import type { BaselineStore } from './baseline';
import { findRepository } from './git/api';
import {
	blameRange,
	logFile,
	logFileByAuthor,
	logFileSince,
	relativeTo,
	showCommitStat,
	type BlameLine,
	type CommitFileChange,
	type RawLogRecord,
} from './git/cli';
import { citedShas, composeEvidence, extractShaMention, type Evidence } from './historian/evidence';
import { suggestFollowups } from './historian/followups';
import { buildUserPrompt, systemPrompt, type HistorianCommand } from './historian/prompt';
import { makeTimeTravellerUri } from './quickDiff';

const FILE_LOG_CAP = 60;

/**
 * Registers the `@historian` chat participant. The participant ID **must**
 * match `contributes.chatParticipants[].id` in `package.json`.
 *
 * Flow: parse slash command → gather evidence (blame + log) → build prompt via
 * the pure helpers in `src/historian/*` → stream LM response → emit commit
 * references + follow-up suggestions.
 */
export function registerHistorianParticipant(baseline: BaselineStore): vscode.Disposable {
	const handler: vscode.ChatRequestHandler = async (request, _ctx, stream, token) => {
		const command = normalizeCommand(request.command);
		const editor = vscode.window.activeTextEditor;
		const fileUri = editor?.document.uri.scheme === 'file' ? editor.document.uri : undefined;

		stream.progress('Gathering history…');

		const evidence = await gatherEvidence({
			command,
			prompt: request.prompt ?? '',
			editor,
			fileUri,
		});

		if (!evidence) {
			stream.markdown(
				'Open a tracked file in a git repository and ask again. `@historian` needs a file under version control to work from.',
			);
			return {};
		}

		for (const sha of citedShas(evidence)) {
			const uri = makeCommitUri(evidence, sha);
			if (uri) stream.reference(uri);
		}

		const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
		if (!model) {
			stream.markdown(
				'No language model is available. Install GitHub Copilot Chat or another provider that exposes `vscode.lm`, then try again.',
			);
			return {};
		}

		const messages: vscode.LanguageModelChatMessage[] = [
			vscode.LanguageModelChatMessage.User(systemPrompt()),
			vscode.LanguageModelChatMessage.User(
				buildUserPrompt(evidence, command, request.prompt ?? ''),
			),
		];

		try {
			const response = await model.sendRequest(messages, {}, token);
			for await (const chunk of response.text) {
				stream.markdown(chunk);
			}
		} catch (err) {
			if (err instanceof Error && err.name === 'Canceled') return {};
			stream.markdown(`\n\n_Language model error: ${(err as Error).message}_`);
		}

		// Touch baseline to satisfy unused-var lint; consumed when we extend the
		// prompt with "current baseline" context in a later pass.
		void baseline;

		return { metadata: { command } };
	};

	const participant = vscode.chat.createChatParticipant('timeTraveller.historian', handler);
	participant.followupProvider = {
		provideFollowups: (result) => {
			const command = normalizeCommand(
				(result.metadata as { command?: string } | undefined)?.command,
			);
			const evidence = (result.metadata as { evidence?: Evidence } | undefined)?.evidence;
			if (!evidence) return [];
			return suggestFollowups(command, evidence).map((f) => ({
				label: f.label,
				prompt: f.prompt,
				command: f.command === 'default' ? undefined : f.command,
				participant: 'timeTraveller.historian',
			}));
		},
	};
	return participant;
}

interface GatherInputs {
	command: HistorianCommand;
	prompt: string;
	editor: vscode.TextEditor | undefined;
	fileUri: vscode.Uri | undefined;
}

async function gatherEvidence(inputs: GatherInputs): Promise<Evidence | undefined> {
	const { fileUri, editor, prompt, command } = inputs;
	if (!fileUri) return undefined;
	const repo = await findRepository(fileUri);
	if (!repo) return undefined;
	const repoRoot = repo.rootUri.fsPath;
	const relPath = relativeTo(repoRoot, fileUri.fsPath);
	if (!relPath || relPath.startsWith('..')) return undefined;

	const referencedSha = extractShaMention(prompt);
	// When the prompt names a specific commit (e.g. from the history panel's
	// "Ask @historian about this commit" action), treat the question as
	// commit-focused and ignore whatever lines happen to be selected in the
	// editor. The user is asking about the commit, not the selection.
	const commitFocused = referencedSha !== undefined;
	const selection = !commitFocused && editor ? resolveSelection(editor, relPath) : undefined;
	const { records, filterDescription } = await loadRecords(command, prompt, repoRoot, relPath);

	let blameLines: BlameLine[] | undefined;
	if (!commitFocused && (command === 'why' || command === 'default') && selection) {
		blameLines = await blameRange(repoRoot, relPath, selection.startLine, selection.endLine);
	}

	let commitFiles: Map<string, CommitFileChange[]> | undefined;
	if (commitFocused && referencedSha) {
		// Resolve the prompt's short SHA to the full SHA via the file log, so
		// `git show` gets a stable ref and `commitFiles` keys match the keys
		// composeEvidence uses for referencedCommits.
		const match = records.find(
			(r) =>
				r.sha.toLowerCase() === referencedSha.toLowerCase() ||
				r.sha.toLowerCase().startsWith(referencedSha.toLowerCase()) ||
				r.shortSha.toLowerCase() === referencedSha.toLowerCase(),
		);
		const fullSha = match?.sha ?? referencedSha;
		const files = await showCommitStat(repoRoot, fullSha);
		if (files.length > 0) {
			commitFiles = new Map([[fullSha, files]]);
		}
	}

	return composeEvidence({
		relPath,
		selection,
		blameLines,
		fileRecords: records,
		referencedShas: referencedSha ? [referencedSha] : undefined,
		filterDescription,
		commitFiles,
	});
}

export function resolveSelection(
	editor: vscode.TextEditor,
	relPath: string,
): Evidence['selection'] | undefined {
	const sel = editor.selection;
	if (sel.isEmpty) return undefined;
	const excerpt = editor.document.getText(sel);
	return {
		relPath,
		startLine: sel.start.line + 1,
		endLine: sel.end.line + 1,
		excerpt,
	};
}

async function loadRecords(
	command: HistorianCommand,
	prompt: string,
	repoRoot: string,
	relPath: string,
): Promise<{ records: RawLogRecord[]; filterDescription?: string }> {
	if (command === 'since') {
		const ref = firstArg(prompt);
		if (!ref) {
			return {
				records: await logFile(repoRoot, relPath, FILE_LOG_CAP),
				filterDescription: '/since needs a ref (e.g. `/since v1.2.0`) — falling back to full log',
			};
		}
		return {
			records: await logFileSince(repoRoot, relPath, ref, FILE_LOG_CAP),
			filterDescription: `commits since ${ref}`,
		};
	}
	if (command === 'author') {
		const pattern = firstArg(prompt);
		if (!pattern) {
			return {
				records: await logFile(repoRoot, relPath, FILE_LOG_CAP),
				filterDescription: '/author needs a name or email pattern — falling back to full log',
			};
		}
		return {
			records: await logFileByAuthor(repoRoot, relPath, pattern, FILE_LOG_CAP),
			filterDescription: `commits by ${pattern}`,
		};
	}
	return { records: await logFile(repoRoot, relPath, FILE_LOG_CAP) };
}

export function normalizeCommand(raw: string | undefined): HistorianCommand {
	switch (raw) {
		case 'why':
		case 'story':
		case 'since':
		case 'author':
			return raw;
		default:
			return 'default';
	}
}

export function firstArg(prompt: string): string | undefined {
	const trimmed = prompt.trim();
	if (!trimmed) return undefined;
	const first = trimmed.split(/\s+/)[0];
	return first.length > 0 ? first : undefined;
}

function makeCommitUri(evidence: Evidence, sha: string): vscode.Uri | undefined {
	if (!evidence.selection) return undefined;
	// We don't have repoRoot in the pure evidence; rebuild from the selection's
	// relPath plus the active editor's workspace folder at reference time.
	const editor = vscode.window.activeTextEditor;
	if (!editor) return undefined;
	const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
	if (!folder) return undefined;
	return makeTimeTravellerUri(folder.uri.fsPath, evidence.selection.relPath, sha);
}
