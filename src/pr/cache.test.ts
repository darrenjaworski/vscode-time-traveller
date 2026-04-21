import { describe, expect, it } from 'vitest';
import { PRCache } from './cache';
import type { PRSummary } from './github';

function pr(number: number): PRSummary {
	return {
		number,
		title: `PR #${number}`,
		body: '',
		url: '',
		state: 'open',
		merged: false,
	};
}

describe('PRCache', () => {
	it('get returns undefined for unknown shas and the stored value for known ones', () => {
		const cache = new PRCache();
		expect(cache.get('a')).toBeUndefined();
		cache.set('a', pr(1));
		expect(cache.get('a')?.number).toBe(1);
	});

	it('distinguishes "known absent" (null) from "not looked up" (undefined)', () => {
		const cache = new PRCache();
		cache.set('a', null);
		expect(cache.has('a')).toBe(true);
		expect(cache.get('a')).toBeNull();
		expect(cache.get('b')).toBeUndefined();
	});

	it('evicts the oldest entry past maxEntries', () => {
		const cache = new PRCache(2);
		cache.set('a', pr(1));
		cache.set('b', pr(2));
		cache.set('c', pr(3));
		expect(cache.has('a')).toBe(false);
		expect(cache.has('b')).toBe(true);
		expect(cache.has('c')).toBe(true);
	});

	it('setting the same sha again bumps it to MRU', () => {
		const cache = new PRCache(2);
		cache.set('a', pr(1));
		cache.set('b', pr(2));
		cache.set('a', pr(10)); // touch a
		cache.set('c', pr(3));
		expect(cache.has('a')).toBe(true);
		expect(cache.has('b')).toBe(false);
	});

	it('clear() empties the cache', () => {
		const cache = new PRCache();
		cache.set('a', pr(1));
		cache.clear();
		expect(cache.size).toBe(0);
	});
});
