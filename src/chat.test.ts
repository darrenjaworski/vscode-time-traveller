import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { firstArg, normalizeCommand, resolveSelection } from './chat';

describe('normalizeCommand', () => {
	it('passes through the four known slash commands', () => {
		expect(normalizeCommand('why')).toBe('why');
		expect(normalizeCommand('story')).toBe('story');
		expect(normalizeCommand('since')).toBe('since');
		expect(normalizeCommand('author')).toBe('author');
	});

	it('falls back to default for unknown or missing commands', () => {
		expect(normalizeCommand(undefined)).toBe('default');
		expect(normalizeCommand('')).toBe('default');
		expect(normalizeCommand('explode')).toBe('default');
	});
});

describe('resolveSelection', () => {
	function makeEditor(startLine: number, startChar: number, endLine: number, endChar: number, text = '') {
		return {
			selection: new vscode.Selection(startLine, startChar, endLine, endChar),
			document: { getText: () => text },
		} as unknown as vscode.TextEditor;
	}

	it('returns undefined when the selection is empty (cursor only)', () => {
		const editor = makeEditor(5, 3, 5, 3);
		expect(resolveSelection(editor, 'src/foo.ts')).toBeUndefined();
	});

	it('returns a selection object with 1-based lines when text is highlighted', () => {
		const editor = makeEditor(2, 0, 4, 10, 'some code');
		expect(resolveSelection(editor, 'src/foo.ts')).toEqual({
			relPath: 'src/foo.ts',
			startLine: 3,
			endLine: 5,
			excerpt: 'some code',
		});
	});
});

describe('firstArg', () => {
	it('returns the first whitespace-delimited token', () => {
		expect(firstArg('v1.2.0')).toBe('v1.2.0');
		expect(firstArg('  v1.2.0  ')).toBe('v1.2.0');
		expect(firstArg('v1.2.0 some trailing text')).toBe('v1.2.0');
	});

	it('returns undefined for empty prompts', () => {
		expect(firstArg('')).toBeUndefined();
		expect(firstArg('   ')).toBeUndefined();
	});
});
