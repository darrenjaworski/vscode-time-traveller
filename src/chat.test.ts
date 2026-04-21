import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { firstArg, normalizeCommand, pickPRCandidates, resolveSelection } from './chat';
import type { BlameLine, RawLogRecord } from './git/cli';

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
	function makeEditor(
		startLine: number,
		startChar: number,
		endLine: number,
		endChar: number,
		text = '',
	) {
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

function record(sha: string): RawLogRecord {
	return {
		sha,
		shortSha: sha.slice(0, 7),
		authorName: 'A',
		authorEmail: 'a@a',
		authorDate: '2026-04-19T12:00:00Z',
		parents: '',
		subject: 's',
		body: '',
	};
}

function blame(sha: string): BlameLine {
	return {
		sha,
		line: 1,
		author: 'A',
		authorEmail: 'a@a',
		authorTime: 0,
		summary: '',
		content: '',
	};
}

describe('pickPRCandidates', () => {
	const a = 'a'.repeat(40);
	const b = 'b'.repeat(40);
	const c = 'c'.repeat(40);

	it('returns [] when there are no inputs', () => {
		expect(
			pickPRCandidates({ records: [], blameLines: undefined, referencedSha: undefined }),
		).toEqual([]);
	});

	it('puts the referenced commit first, resolving short SHAs via the log', () => {
		const out = pickPRCandidates({
			records: [record(b), record(a)],
			blameLines: undefined,
			referencedSha: a.slice(0, 7),
		});
		expect(out[0]).toBe(a);
	});

	it('then unique blame SHAs, then the file log, deduping throughout', () => {
		const out = pickPRCandidates({
			records: [record(a), record(b), record(c)],
			blameLines: [blame(b), blame(b), blame(c)],
			referencedSha: undefined,
		});
		expect(out).toEqual([b, c, a]);
	});

	it('caps at 5 candidates', () => {
		const shas = Array.from({ length: 10 }, (_, i) => String.fromCharCode(97 + i).repeat(40));
		const out = pickPRCandidates({
			records: shas.map(record),
			blameLines: undefined,
			referencedSha: undefined,
		});
		expect(out).toHaveLength(5);
	});

	it('falls back to the referenced SHA itself when the log has no match but the SHA is full', () => {
		const rogue = 'f'.repeat(40);
		const out = pickPRCandidates({
			records: [record(a)],
			blameLines: undefined,
			referencedSha: rogue,
		});
		expect(out).toEqual([rogue, a]);
	});
});
