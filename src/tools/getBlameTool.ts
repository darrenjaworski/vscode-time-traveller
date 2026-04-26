import * as vscode from 'vscode';
import { getBlame, type GetBlameInput, type GetBlameDeps } from './getBlame';

export class GetBlameTool implements vscode.LanguageModelTool<GetBlameInput> {
	constructor(private readonly deps: GetBlameDeps) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<GetBlameInput>,
	): Promise<vscode.LanguageModelToolResult> {
		const text = await getBlame(options.input, this.deps);
		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
	}

	async prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<GetBlameInput>,
	): Promise<vscode.PreparedToolInvocation> {
		return {
			invocationMessage: `Blaming lines ${options.input.startLine}–${options.input.endLine} of ${options.input.relPath}…`,
		};
	}
}
