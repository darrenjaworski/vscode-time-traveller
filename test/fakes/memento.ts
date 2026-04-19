import type { Memento } from 'vscode';

export class FakeMemento implements Memento {
	private readonly store = new Map<string, unknown>();

	keys(): readonly string[] {
		return Array.from(this.store.keys());
	}

	get<T>(key: string): T | undefined;
	get<T>(key: string, defaultValue: T): T;
	get<T>(key: string, defaultValue?: T): T | undefined {
		return (this.store.has(key) ? (this.store.get(key) as T) : defaultValue) as T | undefined;
	}

	async update(key: string, value: unknown): Promise<void> {
		if (value === undefined) {
			this.store.delete(key);
		} else {
			this.store.set(key, value);
		}
	}

	setKeysForSync(): void {
		/* noop */
	}
}
