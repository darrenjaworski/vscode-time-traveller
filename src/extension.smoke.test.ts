/**
 * Smoke test — activates the extension against the `vscode` mock and verifies
 * that no import/wiring throws, every declared command is registered, and
 * deactivate() is safe to call. This is not a replacement for a VS Code
 * test-electron run; it just catches the "did I forget to wire X" class of
 * regressions cheaply.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { activate, deactivate } from './extension';
import { FakeMemento } from '../test/fakes/memento';
import packageJson from '../package.json';

function fakeContext(): vscode.ExtensionContext {
	return {
		subscriptions: [] as { dispose(): unknown }[],
		workspaceState: new FakeMemento(),
		globalState: new FakeMemento(),
	} as unknown as vscode.ExtensionContext;
}

afterEach(() => {
	vi.clearAllMocks();
});

describe('extension activation', () => {
	it('activate() runs without throwing against the vscode mock', () => {
		const ctx = fakeContext();
		expect(() => activate(ctx)).not.toThrow();
		expect(ctx.subscriptions.length).toBeGreaterThan(0);
	});

	it('registers every command declared in package.json', () => {
		const ctx = fakeContext();
		activate(ctx);
		const registered = vi.mocked(vscode.commands.registerCommand).mock.calls.map(([id]) => id);
		const declared = packageJson.contributes.commands.map((c) => c.command);
		for (const id of declared) {
			expect(registered, `expected command ${id} to be registered`).toContain(id);
		}
	});

	it('creates a status bar item, SCM source control, tree view, and chat participant', () => {
		const ctx = fakeContext();
		activate(ctx);
		expect(vscode.window.createStatusBarItem).toHaveBeenCalled();
		expect(vscode.scm.createSourceControl).toHaveBeenCalledWith(
			'timeTraveller',
			'Time Traveller (baseline)',
			undefined,
		);
		expect(vscode.window.createTreeView).toHaveBeenCalledWith(
			'timeTraveller.fileHistory',
			expect.any(Object),
		);
		expect(vscode.chat.createChatParticipant).toHaveBeenCalledWith(
			'timeTraveller.blame',
			expect.any(Function),
		);
	});

	it('deactivate() is a safe noop', () => {
		expect(() => deactivate()).not.toThrow();
	});
});
