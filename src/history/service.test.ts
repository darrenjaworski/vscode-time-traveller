import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type { RawLogRecord } from '../git/cli';
import {
	applyRenames,
	getFileHistory,
	HistoryCache,
	HISTORY_PAGE_SIZE,
	toHistoryEntry,
	type HistoryContext,
	type HistoryEntry,
} from './service';

function baseRecord(overrides: Partial<RawLogRecord> = {}): RawLogRecord {
	return {
		sha: 'a'.repeat(40),
		shortSha: 'aaaaaaa',
		authorName: 'Alice',
		authorEmail: 'alice@example.com',
		authorDate: '2026-04-19T12:00:00Z',
		parents: `${'b'.repeat(40)}`,
		subject: 'Do the thing',
		body: 'Body text',
		...overrides,
	};
}

describe('toHistoryEntry', () => {
	it('maps scalar fields through untouched', () => {
		const entry = toHistoryEntry(baseRecord());
		expect(entry).toMatchObject({
			sha: 'a'.repeat(40),
			shortSha: 'aaaaaaa',
			authorName: 'Alice',
			authorEmail: 'alice@example.com',
			subject: 'Do the thing',
			body: 'Body text',
		});
	});

	it('parses the ISO author date into a Date object', () => {
		const entry = toHistoryEntry(baseRecord({ authorDate: '2026-01-02T03:04:05Z' }));
		expect(entry.authorDate).toBeInstanceOf(Date);
		expect(entry.authorDate.toISOString()).toBe('2026-01-02T03:04:05.000Z');
	});

	it('splits parents on whitespace and filters empties', () => {
		const entry = toHistoryEntry(baseRecord({ parents: `${'b'.repeat(40)} ${'c'.repeat(40)}` }));
		expect(entry.parents).toEqual(['b'.repeat(40), 'c'.repeat(40)]);
	});

	it('treats zero or one parents as a non-merge', () => {
		expect(toHistoryEntry(baseRecord({ parents: '' })).isMerge).toBe(false);
		expect(toHistoryEntry(baseRecord({ parents: 'b'.repeat(40) })).isMerge).toBe(false);
	});

	it('flags two-or-more-parent commits as merges', () => {
		const entry = toHistoryEntry(baseRecord({ parents: `${'b'.repeat(40)} ${'c'.repeat(40)}` }));
		expect(entry.isMerge).toBe(true);
	});
});

function entry(sha: string, overrides: Partial<HistoryEntry> = {}): HistoryEntry {
	return {
		sha,
		shortSha: sha.slice(0, 7),
		subject: 's',
		body: '',
		authorName: 'A',
		authorEmail: 'a@a',
		authorDate: new Date('2026-01-01T00:00:00Z'),
		parents: [],
		isMerge: false,
		...overrides,
	};
}

describe('applyRenames', () => {
	it('annotates the newer entry when adjacent paths differ', () => {
		const entries = [entry('a1'), entry('b2'), entry('c3')];
		const paths = new Map([
			['a1', 'src/new.ts'],
			['b2', 'src/old.ts'],
			['c3', 'src/old.ts'],
		]);
		applyRenames(entries, paths);
		expect(entries[0].renamedFrom).toBe('src/old.ts');
		expect(entries[1].renamedFrom).toBeUndefined();
		expect(entries[2].renamedFrom).toBeUndefined();
	});

	it('supports multiple renames in a single chain', () => {
		const entries = [entry('a1'), entry('b2'), entry('c3')];
		const paths = new Map([
			['a1', 'v3.ts'],
			['b2', 'v2.ts'],
			['c3', 'v1.ts'],
		]);
		applyRenames(entries, paths);
		expect(entries[0].renamedFrom).toBe('v2.ts');
		expect(entries[1].renamedFrom).toBe('v1.ts');
	});

	it('skips entries missing from the map', () => {
		const entries = [entry('a1'), entry('b2')];
		const paths = new Map([['a1', 'src/foo.ts']]);
		applyRenames(entries, paths);
		expect(entries[0].renamedFrom).toBeUndefined();
	});

	it('is a no-op when paths are identical across the log', () => {
		const entries = [entry('a1'), entry('b2')];
		const paths = new Map([
			['a1', 'src/foo.ts'],
			['b2', 'src/foo.ts'],
		]);
		applyRenames(entries, paths);
		expect(entries[0].renamedFrom).toBeUndefined();
	});
});

describe('HistoryCache', () => {
	function ctx(repoRoot: string, relPath: string, limit: number): HistoryContext {
		return { repoRoot, relPath, entries: [], hasMore: false, limit };
	}

	it('returns undefined on miss, the stored value on hit', () => {
		const cache = new HistoryCache();
		expect(cache.get('/r', 'f.ts', 50)).toBeUndefined();
		const value = ctx('/r', 'f.ts', 50);
		cache.set('/r', 'f.ts', 50, value);
		expect(cache.get('/r', 'f.ts', 50)).toBe(value);
	});

	it('treats different limits as distinct keys', () => {
		const cache = new HistoryCache();
		cache.set('/r', 'f.ts', 50, ctx('/r', 'f.ts', 50));
		expect(cache.get('/r', 'f.ts', 100)).toBeUndefined();
	});

	it('evicts the oldest entry once maxEntries is exceeded', () => {
		const cache = new HistoryCache(2);
		cache.set('/r', 'a.ts', 50, ctx('/r', 'a.ts', 50));
		cache.set('/r', 'b.ts', 50, ctx('/r', 'b.ts', 50));
		cache.set('/r', 'c.ts', 50, ctx('/r', 'c.ts', 50));
		expect(cache.get('/r', 'a.ts', 50)).toBeUndefined();
		expect(cache.get('/r', 'b.ts', 50)).toBeDefined();
		expect(cache.get('/r', 'c.ts', 50)).toBeDefined();
	});

	it('bumps hit entries to MRU so a read protects them from eviction', () => {
		const cache = new HistoryCache(2);
		cache.set('/r', 'a.ts', 50, ctx('/r', 'a.ts', 50));
		cache.set('/r', 'b.ts', 50, ctx('/r', 'b.ts', 50));
		cache.get('/r', 'a.ts', 50); // touch a -> MRU
		cache.set('/r', 'c.ts', 50, ctx('/r', 'c.ts', 50));
		expect(cache.get('/r', 'a.ts', 50)).toBeDefined();
		expect(cache.get('/r', 'b.ts', 50)).toBeUndefined();
	});

	it('invalidateRepo drops every entry for that repo root', () => {
		const cache = new HistoryCache();
		cache.set('/r1', 'a.ts', 50, ctx('/r1', 'a.ts', 50));
		cache.set('/r1', 'b.ts', 50, ctx('/r1', 'b.ts', 50));
		cache.set('/r2', 'c.ts', 50, ctx('/r2', 'c.ts', 50));
		cache.invalidateRepo('/r1');
		expect(cache.get('/r1', 'a.ts', 50)).toBeUndefined();
		expect(cache.get('/r1', 'b.ts', 50)).toBeUndefined();
		expect(cache.get('/r2', 'c.ts', 50)).toBeDefined();
	});

	it('invalidateFile drops only matching path entries across all limits', () => {
		const cache = new HistoryCache();
		cache.set('/r', 'a.ts', 50, ctx('/r', 'a.ts', 50));
		cache.set('/r', 'a.ts', 100, ctx('/r', 'a.ts', 100));
		cache.set('/r', 'b.ts', 50, ctx('/r', 'b.ts', 50));
		cache.invalidateFile('/r', 'a.ts');
		expect(cache.get('/r', 'a.ts', 50)).toBeUndefined();
		expect(cache.get('/r', 'a.ts', 100)).toBeUndefined();
		expect(cache.get('/r', 'b.ts', 50)).toBeDefined();
	});
});

describe('getFileHistory pagination', () => {
	function makeDeps(records: RawLogRecord[]) {
		return {
			findRepo: vi.fn(async () => ({ rootUri: vscode.Uri.file('/repo') })) as never,
			log: vi.fn(async (_root: string, _rel: string, max: number) => records.slice(0, max)),
			renames: vi.fn(async () => new Map<string, string>()),
		};
	}

	it('sets hasMore=true when git returns exactly `limit` records', async () => {
		const records = Array.from({ length: 50 }, (_, i) =>
			baseRecord({ sha: String(i).padStart(40, '0') }),
		);
		const result = await getFileHistory(vscode.Uri.file('/repo/a.ts'), 50, makeDeps(records));
		expect(result?.hasMore).toBe(true);
		expect(result?.limit).toBe(50);
		expect(result?.entries).toHaveLength(50);
	});

	it('sets hasMore=false when git returns fewer than requested', async () => {
		const records = Array.from({ length: 12 }, (_, i) =>
			baseRecord({ sha: String(i).padStart(40, '0') }),
		);
		const result = await getFileHistory(vscode.Uri.file('/repo/a.ts'), 50, makeDeps(records));
		expect(result?.hasMore).toBe(false);
		expect(result?.entries).toHaveLength(12);
	});

	it('memoizes via cache so repeat calls skip the shell-out', async () => {
		const records = [baseRecord()];
		const deps = makeDeps(records);
		const cache = new HistoryCache();
		const first = await getFileHistory(vscode.Uri.file('/repo/a.ts'), 50, deps, cache);
		const second = await getFileHistory(vscode.Uri.file('/repo/a.ts'), 50, deps, cache);
		expect(second).toBe(first);
		expect(deps.log).toHaveBeenCalledTimes(1);
	});

	it('re-shells after invalidateRepo', async () => {
		const deps = makeDeps([baseRecord()]);
		const cache = new HistoryCache();
		await getFileHistory(vscode.Uri.file('/repo/a.ts'), 50, deps, cache);
		cache.invalidateRepo('/repo');
		await getFileHistory(vscode.Uri.file('/repo/a.ts'), 50, deps, cache);
		expect(deps.log).toHaveBeenCalledTimes(2);
	});

	it('defaults maxCount to HISTORY_PAGE_SIZE', async () => {
		const deps = makeDeps([baseRecord()]);
		await getFileHistory(vscode.Uri.file('/repo/a.ts'), undefined, deps);
		expect(deps.log).toHaveBeenCalledWith('/repo', 'a.ts', HISTORY_PAGE_SIZE);
	});
});
