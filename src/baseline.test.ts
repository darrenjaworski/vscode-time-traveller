import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { FakeMemento } from '../test/fakes/memento';
import { BaselineStore, type BaselineChange } from './baseline';

const fileA = vscode.Uri.file('/repo/src/foo.ts');
const fileB = vscode.Uri.file('/repo/src/bar.ts');

describe('BaselineStore — global scope', () => {
	it('returns undefined when nothing is stored', () => {
		const store = new BaselineStore(new FakeMemento());
		expect(store.get()).toBeUndefined();
		expect(store.getGlobal()).toBeUndefined();
	});

	it('persists and returns the value', async () => {
		const store = new BaselineStore(new FakeMemento());
		await store.set('v1.0.0');
		expect(store.getGlobal()).toBe('v1.0.0');
		expect(store.get()).toBe('v1.0.0');
	});

	it('treats an empty string as unset', async () => {
		const memento = new FakeMemento();
		await memento.update('timeTraveller.baselineRef', '');
		const store = new BaselineStore(memento);
		expect(store.getGlobal()).toBeUndefined();
	});

	it('fires onDidChange with scope=global', async () => {
		const store = new BaselineStore(new FakeMemento());
		const listener = vi.fn<(c: BaselineChange) => void>();
		store.onDidChange(listener);

		await store.set('abc');
		await store.set(undefined);

		expect(listener).toHaveBeenNthCalledWith(1, { scope: 'global', ref: 'abc' });
		expect(listener).toHaveBeenNthCalledWith(2, { scope: 'global', ref: undefined });
	});

	it('clears the memento when set(undefined) is called', async () => {
		const memento = new FakeMemento();
		const store = new BaselineStore(memento);
		await store.set('ref');
		await store.set(undefined);
		expect(memento.keys()).not.toContain('timeTraveller.baselineRef');
	});
});

describe('BaselineStore — per-file scope', () => {
	it('returns undefined when the file has no override', () => {
		const store = new BaselineStore(new FakeMemento());
		expect(store.getForFile(fileA)).toBeUndefined();
		expect(store.hasFileOverride(fileA)).toBe(false);
	});

	it('persists a per-file override independent of the global ref', async () => {
		const store = new BaselineStore(new FakeMemento());
		await store.set('main');
		await store.setForFile(fileA, 'abc1234');
		expect(store.getGlobal()).toBe('main');
		expect(store.getForFile(fileA)).toBe('abc1234');
		expect(store.hasFileOverride(fileA)).toBe(true);
	});

	it('get(uri) prefers per-file over global', async () => {
		const store = new BaselineStore(new FakeMemento());
		await store.set('main');
		await store.setForFile(fileA, 'abc1234');
		expect(store.get(fileA)).toBe('abc1234');
		expect(store.get(fileB)).toBe('main'); // falls back to global
	});

	it('get() with no URI returns the global ref', async () => {
		const store = new BaselineStore(new FakeMemento());
		await store.set('main');
		await store.setForFile(fileA, 'abc1234');
		expect(store.get()).toBe('main');
	});

	it('different URIs get independent overrides', async () => {
		const store = new BaselineStore(new FakeMemento());
		await store.setForFile(fileA, 'sha-a');
		await store.setForFile(fileB, 'sha-b');
		expect(store.getForFile(fileA)).toBe('sha-a');
		expect(store.getForFile(fileB)).toBe('sha-b');
	});

	it('clearForFile removes only that URI and falls back to global', async () => {
		const store = new BaselineStore(new FakeMemento());
		await store.set('main');
		await store.setForFile(fileA, 'abc1234');
		await store.clearForFile(fileA);
		expect(store.hasFileOverride(fileA)).toBe(false);
		expect(store.get(fileA)).toBe('main');
	});

	it('fires onDidChange with scope=file and the URI', async () => {
		const store = new BaselineStore(new FakeMemento());
		const listener = vi.fn<(c: BaselineChange) => void>();
		store.onDidChange(listener);

		await store.setForFile(fileA, 'abc1234');
		await store.clearForFile(fileA);

		expect(listener).toHaveBeenNthCalledWith(1, {
			scope: 'file',
			uri: fileA,
			ref: 'abc1234',
		});
		expect(listener).toHaveBeenNthCalledWith(2, {
			scope: 'file',
			uri: fileA,
			ref: undefined,
		});
	});

	it('clearing global does not clear per-file overrides', async () => {
		const store = new BaselineStore(new FakeMemento());
		await store.set('main');
		await store.setForFile(fileA, 'abc1234');
		await store.set(undefined);
		expect(store.get(fileA)).toBe('abc1234');
	});
});
