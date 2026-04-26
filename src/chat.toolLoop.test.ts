/**
 * Integration tests for the tool-calling loop in `chat.ts`. Exercises the
 * orchestration logic — looping, tool invocation, message accumulation —
 * against a fake `LanguageModelChat` and a mocked `vscode.lm.invokeTool`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { runToolCallingLoop, type ToolCallingLoopInputs } from './chat';
import type { Evidence } from './historian/evidence';

function makeEvidence(): Evidence {
	return {
		relPath: 'src/foo.ts',
		fileCommits: [
			{
				sha: 'abc1234567890abc1234567890abc1234567890a',
				shortSha: 'abc1234',
				subject: 'Add foo',
				body: 'Some body that should not appear in slim prompt',
				authorName: 'Alice',
				authorEmail: 'alice@example.com',
				authorDate: new Date('2024-01-01T00:00:00Z'),
				isMerge: false,
			},
		],
		referencedCommits: [],
		// Include a commit diff to verify slim-prompt mode strips it.
		commitDiffs: new Map([
			['abc1234567890abc1234567890abc1234567890a', 'DIFFCONTENT_SHOULD_BE_STRIPPED'],
		]),
	};
}

async function* makePartStream(parts: unknown[]) {
	for (const p of parts) yield p;
}

function makeRequest(): vscode.ChatRequest {
	return {
		prompt: 'why did this change?',
		toolInvocationToken: {} as never,
	} as unknown as vscode.ChatRequest;
}

function makeToken(): vscode.CancellationToken {
	return {
		isCancellationRequested: false,
		onCancellationRequested: vi.fn(),
	} as unknown as vscode.CancellationToken;
}

function makeStream(): vscode.ChatResponseStream & { markdown: ReturnType<typeof vi.fn> } {
	return {
		markdown: vi.fn(),
		progress: vi.fn(),
		reference: vi.fn(),
		button: vi.fn(),
		anchor: vi.fn(),
		filetree: vi.fn(),
		push: vi.fn(),
	} as unknown as vscode.ChatResponseStream & { markdown: ReturnType<typeof vi.fn> };
}

function baseInputs(model: { sendRequest: ReturnType<typeof vi.fn> }): ToolCallingLoopInputs {
	return {
		model: model as unknown as vscode.LanguageModelChat,
		evidence: makeEvidence(),
		command: 'why',
		request: makeRequest(),
		messages: [],
		stream: makeStream(),
		token: makeToken(),
		tools: [{ name: 'timeTraveller_getBlame', description: 'blame', inputSchema: {} }],
		maxRounds: 5,
	};
}

describe('runToolCallingLoop', () => {
	beforeEach(() => {
		vi.mocked(vscode.lm.invokeTool).mockReset();
	});

	it('exits after one round when model returns text only', async () => {
		const model = {
			sendRequest: vi.fn().mockResolvedValueOnce({
				stream: makePartStream([new vscode.LanguageModelTextPart('hello world')]),
			}),
		};
		const inputs = baseInputs(model);

		await runToolCallingLoop(inputs);

		expect(model.sendRequest).toHaveBeenCalledTimes(1);
		expect(vscode.lm.invokeTool).not.toHaveBeenCalled();
		const stream = inputs.stream as unknown as { markdown: ReturnType<typeof vi.fn> };
		expect(stream.markdown).toHaveBeenCalledWith('hello world');
	});

	it('invokes a tool, appends the result, and finalizes on the next round', async () => {
		vi.mocked(vscode.lm.invokeTool).mockResolvedValueOnce({
			content: [new vscode.LanguageModelTextPart('tool output')],
		} as unknown as vscode.LanguageModelToolResult);

		const model = {
			sendRequest: vi
				.fn()
				.mockResolvedValueOnce({
					stream: makePartStream([
						new vscode.LanguageModelToolCallPart('call-1', 'timeTraveller_getBlame', {
							sha: 'abc',
						}),
					]),
				})
				.mockResolvedValueOnce({
					stream: makePartStream([new vscode.LanguageModelTextPart('final answer')]),
				}),
		};
		const inputs = baseInputs(model);

		await runToolCallingLoop(inputs);

		expect(model.sendRequest).toHaveBeenCalledTimes(2);
		expect(vscode.lm.invokeTool).toHaveBeenCalledTimes(1);
		expect(vscode.lm.invokeTool).toHaveBeenCalledWith(
			'timeTraveller_getBlame',
			expect.objectContaining({ input: { sha: 'abc' } }),
			expect.anything(),
		);

		const stream = inputs.stream as unknown as { markdown: ReturnType<typeof vi.fn> };
		expect(stream.markdown).toHaveBeenCalledWith('final answer');

		// Second sendRequest should have received the appended tool result message.
		const secondCallMessages = model.sendRequest.mock.calls[1][0] as Array<{
			content: unknown;
		}>;
		const lastMsg = secondCallMessages[secondCallMessages.length - 1];
		const parts = lastMsg.content as unknown[];
		const resultPart = parts[0] as {
			callId: string;
			content: vscode.LanguageModelTextPart[];
		};
		expect(parts[0]).toBeInstanceOf(vscode.LanguageModelToolResultPart);
		expect(resultPart.callId).toBe('call-1');
		expect(resultPart.content[0].value).toBe('tool output');
	});

	it('handles multiple tool calls in a single round', async () => {
		vi.mocked(vscode.lm.invokeTool)
			.mockResolvedValueOnce({
				content: [new vscode.LanguageModelTextPart('result A')],
			} as unknown as vscode.LanguageModelToolResult)
			.mockResolvedValueOnce({
				content: [new vscode.LanguageModelTextPart('result B')],
			} as unknown as vscode.LanguageModelToolResult);

		const model = {
			sendRequest: vi
				.fn()
				.mockResolvedValueOnce({
					stream: makePartStream([
						new vscode.LanguageModelToolCallPart('c1', 'timeTraveller_a', {}),
						new vscode.LanguageModelToolCallPart('c2', 'timeTraveller_b', {}),
					]),
				})
				.mockResolvedValueOnce({
					stream: makePartStream([new vscode.LanguageModelTextPart('done')]),
				}),
		};
		const inputs = baseInputs(model);

		await runToolCallingLoop(inputs);

		expect(vscode.lm.invokeTool).toHaveBeenCalledTimes(2);

		const secondCallMessages = model.sendRequest.mock.calls[1][0] as Array<{ content: unknown }>;
		// Two tool-result messages should have been appended after the initial 2 (system + user).
		expect(secondCallMessages).toHaveLength(4);
		const callIds = secondCallMessages.slice(2).map((m) => {
			const parts = m.content as unknown[];
			return (parts[0] as vscode.LanguageModelToolResultPart).callId;
		});
		expect(callIds).toEqual(['c1', 'c2']);
	});

	it('caps iterations at maxRounds when the model never stops emitting tool calls', async () => {
		vi.mocked(vscode.lm.invokeTool).mockResolvedValue({
			content: [new vscode.LanguageModelTextPart('tool result')],
		} as unknown as vscode.LanguageModelToolResult);

		const model = {
			sendRequest: vi.fn().mockImplementation(async () => ({
				stream: makePartStream([
					new vscode.LanguageModelToolCallPart('c', 'timeTraveller_loop', {}),
				]),
			})),
		};
		const inputs = baseInputs(model);
		inputs.maxRounds = 3;

		await runToolCallingLoop(inputs);

		expect(model.sendRequest).toHaveBeenCalledTimes(3);
		expect(vscode.lm.invokeTool).toHaveBeenCalledTimes(3);
	});

	it('uses the slim prompt (no commit diffs) for the first user message', async () => {
		const model = {
			sendRequest: vi.fn().mockResolvedValueOnce({
				stream: makePartStream([new vscode.LanguageModelTextPart('ok')]),
			}),
		};
		const inputs = baseInputs(model);

		await runToolCallingLoop(inputs);

		const firstCallMessages = model.sendRequest.mock.calls[0][0] as Array<{
			role: string;
			content: string;
		}>;
		// Last initial message is the user prompt.
		const userMsg = firstCallMessages[firstCallMessages.length - 1];
		expect(userMsg.role).toBe('user');
		expect(userMsg.content).not.toContain('DIFFCONTENT_SHOULD_BE_STRIPPED');
		expect(userMsg.content).toContain('why did this change?');
	});
});
