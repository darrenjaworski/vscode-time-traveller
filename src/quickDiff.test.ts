import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { makeTimeTravellerUri, resolveRefForUri, TIME_TRAVELLER_SCHEME } from './quickDiff';

describe('makeTimeTravellerUri', () => {
	it('builds a TT-scheme URI with the ref pinned in the query', () => {
		const uri = makeTimeTravellerUri('/repo', 'src/foo.ts', 'abc1234');
		expect(uri.scheme).toBe(TIME_TRAVELLER_SCHEME);
		expect(uri.path).toBe('/repo/src/foo.ts');
		expect(uri.query).toBe('ref=abc1234');
	});

	it('URL-encodes the ref so branch names with slashes survive', () => {
		const uri = makeTimeTravellerUri('/repo', 'a.ts', 'origin/main');
		expect(uri.query).toBe('ref=origin%2Fmain');
	});

	it('normalizes Windows-style separators in relPath', () => {
		const uri = makeTimeTravellerUri('/repo', 'src\\foo.ts', 'HEAD');
		expect(uri.path).toBe('/repo/src/foo.ts');
	});
});

describe('resolveRefForUri', () => {
	it('returns the query ref when the URI carries one (explicit-ref URI)', () => {
		const uri = makeTimeTravellerUri('/repo', 'src/foo.ts', 'abc1234');
		expect(resolveRefForUri(uri, () => 'main')).toBe('abc1234');
	});

	it('falls back to the baseline store when the URI has no query', () => {
		const uri = vscode.Uri.from({ scheme: TIME_TRAVELLER_SCHEME, path: '/repo/src/foo.ts' });
		expect(resolveRefForUri(uri, () => 'feature/x')).toBe('feature/x');
	});

	it('defaults to HEAD when neither the URI nor the store provide a ref', () => {
		const uri = vscode.Uri.from({ scheme: TIME_TRAVELLER_SCHEME, path: '/repo/src/foo.ts' });
		expect(resolveRefForUri(uri, () => undefined)).toBe('HEAD');
	});

	it('asks the store with a file-scheme URI so per-file overrides resolve', () => {
		let askedWith: vscode.Uri | undefined;
		const uri = vscode.Uri.from({ scheme: TIME_TRAVELLER_SCHEME, path: '/repo/src/foo.ts' });
		resolveRefForUri(uri, (fileUri) => {
			askedWith = fileUri;
			return undefined;
		});
		expect(askedWith?.scheme).toBe('file');
		expect(askedWith?.path).toBe('/repo/src/foo.ts');
	});
});
