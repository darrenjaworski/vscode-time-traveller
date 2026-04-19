import { describe, expect, it, vi } from 'vitest';
import { FakeMemento } from '../test/fakes/memento';
import { BaselineStore } from './baseline';

describe('BaselineStore', () => {
	it('returns undefined when nothing is stored', () => {
		const store = new BaselineStore(new FakeMemento());
		expect(store.get()).toBeUndefined();
	});

	it('persists and returns the value', async () => {
		const store = new BaselineStore(new FakeMemento());
		await store.set('v1.0.0');
		expect(store.get()).toBe('v1.0.0');
	});

	it('treats an empty string as unset', async () => {
		const memento = new FakeMemento();
		await memento.update('timeTraveller.baselineRef', '');
		const store = new BaselineStore(memento);
		expect(store.get()).toBeUndefined();
	});

	it('fires onDidChange when the ref changes', async () => {
		const store = new BaselineStore(new FakeMemento());
		const listener = vi.fn();
		store.onDidChange(listener);

		await store.set('abc');
		await store.set(undefined);

		expect(listener).toHaveBeenCalledTimes(2);
		expect(listener).toHaveBeenNthCalledWith(1, 'abc');
		expect(listener).toHaveBeenNthCalledWith(2, undefined);
	});

	it('clears the memento when set(undefined) is called', async () => {
		const memento = new FakeMemento();
		const store = new BaselineStore(memento);
		await store.set('ref');
		await store.set(undefined);
		expect(memento.keys()).not.toContain('timeTraveller.baselineRef');
	});
});
