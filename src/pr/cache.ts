import type { PRSummary } from './github';

/**
 * Session-scoped PR cache. Keyed by full SHA so short-SHA lookups need to
 * resolve to full SHAs first (we do this in the chat orchestrator via the
 * file log). `null` is a sentinel for "we looked, no PR found" — so we don't
 * re-hit the API for the same known-empty commits.
 */
export class PRCache {
	private readonly map = new Map<string, PRSummary | null>();

	constructor(private readonly maxEntries: number = 256) {}

	has(sha: string): boolean {
		return this.map.has(sha);
	}

	get(sha: string): PRSummary | null | undefined {
		return this.map.get(sha);
	}

	set(sha: string, value: PRSummary | null): void {
		this.map.delete(sha);
		this.map.set(sha, value);
		while (this.map.size > this.maxEntries) {
			const oldest = this.map.keys().next().value;
			if (oldest === undefined) break;
			this.map.delete(oldest);
		}
	}

	clear(): void {
		this.map.clear();
	}

	get size(): number {
		return this.map.size;
	}
}
