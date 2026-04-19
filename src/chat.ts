import * as vscode from 'vscode';
import { BaselineStore } from './baseline';

export function registerBlameParticipant(baseline: BaselineStore): vscode.Disposable {
	const handler: vscode.ChatRequestHandler = async (request, _ctx, stream, token) => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			stream.markdown(
				'Open a file and select the lines you want explained, then ask `@blame` again.',
			);
			return;
		}

		const selection = editor.selection;
		const doc = editor.document;
		const range = selection.isEmpty
			? new vscode.Range(selection.active.line, 0, selection.active.line, Number.MAX_SAFE_INTEGER)
			: selection;
		const excerpt = doc.getText(range);
		const ref = baseline.get() ?? 'HEAD';

		stream.progress('Gathering history…');

		const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
		if (!model) {
			stream.markdown(
				'No language model is available. Install GitHub Copilot Chat or another provider that exposes `vscode.lm`.',
			);
			return;
		}

		const messages: vscode.LanguageModelChatMessage[] = [
			vscode.LanguageModelChatMessage.User(
				[
					'You are @blame, a narrator of git history.',
					`The user asked: ${request.prompt || '(no prompt — explain why these lines changed)'}`,
					`Baseline ref: ${ref}`,
					`File: ${vscode.workspace.asRelativePath(doc.uri)} (lines ${range.start.line + 1}-${range.end.line + 1})`,
					'',
					'--- excerpt ---',
					excerpt,
					'--- end excerpt ---',
					'',
					'For now, produce a short placeholder response acknowledging the request.',
					'Future versions will include commit messages, diffs, and PR context.',
				].join('\n'),
			),
		];

		const response = await model.sendRequest(messages, {}, token);
		for await (const chunk of response.text) {
			stream.markdown(chunk);
		}
	};

	const participant = vscode.chat.createChatParticipant('timeTraveller.blame', handler);
	return participant;
}
