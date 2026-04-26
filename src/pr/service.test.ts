import { describe, it, expect, vi } from 'vitest';
import { lookupPRs, type PRLookupInput } from './service';
import { PRCache } from './cache';
import type { PRSummary } from './github';

function pr(number: number, merged: boolean = false): PRSummary {
	return {
		number,
		title: `PR #${number}`,
		body: '',
		url: `https://github.com/owner/repo/pull/${number}`,
		state: merged ? 'closed' : 'open',
		merged,
	};
}

describe('lookupPRs', () => {
	it('case 1: empty shas → empty map, zero dep calls', async () => {
		const cache = new PRCache();
		const resolveGitHubRemote = vi.fn();
		const fetchPRsForCommit = vi.fn();
		const getToken = vi.fn();

		const input: PRLookupInput = {
			repoRoot: '/repo',
			shas: [],
			cache,
		};

		const result = await lookupPRs(input, {
			resolveGitHubRemote,
			fetchPRsForCommit,
			getToken,
		});

		expect(result.size).toBe(0);
		expect(resolveGitHubRemote).not.toHaveBeenCalled();
		expect(fetchPRsForCommit).not.toHaveBeenCalled();
		expect(getToken).not.toHaveBeenCalled();
	});

	it('case 2: all cache hits with PR objects → returned, no fetch calls', async () => {
		const cache = new PRCache();
		const pr1 = pr(123, false);
		const pr2 = pr(456, true);
		cache.set('sha1', pr1);
		cache.set('sha2', pr2);

		const input: PRLookupInput = {
			repoRoot: '/repo',
			shas: ['sha1', 'sha2'],
			cache,
		};

		const result = await lookupPRs(input, {
			resolveGitHubRemote: vi.fn(),
			fetchPRsForCommit: vi.fn(),
			getToken: vi.fn(),
		});

		expect(result.get('sha1')).toEqual(pr1);
		expect(result.get('sha2')).toEqual(pr2);
		expect(result.size).toBe(2);
	});

	it('case 3: all cache hits with nulls → empty map, no fetch calls', async () => {
		const cache = new PRCache();
		cache.set('sha1', null);
		cache.set('sha2', null);

		const input: PRLookupInput = {
			repoRoot: '/repo',
			shas: ['sha1', 'sha2'],
			cache,
		};

		const result = await lookupPRs(input, {
			resolveGitHubRemote: vi.fn(),
			fetchPRsForCommit: vi.fn(),
			getToken: vi.fn(),
		});

		expect(result.size).toBe(0);
	});

	it('case 4: non-GitHub remote → no fetches, nulls cached for uncached shas', async () => {
		const cache = new PRCache();
		const fetchPRsForCommit = vi.fn();

		const input: PRLookupInput = {
			repoRoot: '/repo',
			shas: ['sha1', 'sha2'],
			cache,
		};

		const result = await lookupPRs(input, {
			resolveGitHubRemote: vi.fn().mockResolvedValue(undefined),
			fetchPRsForCommit,
			getToken: vi.fn(),
		});

		expect(result.size).toBe(0);
		expect(fetchPRsForCommit).not.toHaveBeenCalled();
		// Verify cache was populated with nulls
		expect(cache.get('sha1')).toBe(null);
		expect(cache.get('sha2')).toBe(null);
	});

	it('case 5: limit cap → only first N shas fetched, rest neither fetched nor cached', async () => {
		const cache = new PRCache();
		const fetchPRsForCommit = vi.fn().mockResolvedValue([pr(100, false)]);

		const input: PRLookupInput = {
			repoRoot: '/repo',
			shas: ['sha1', 'sha2', 'sha3', 'sha4'],
			cache,
			limit: 2,
		};

		await lookupPRs(input, {
			resolveGitHubRemote: vi.fn().mockResolvedValue({ host: 'github', owner: 'o', repo: 'r' }),
			fetchPRsForCommit,
			getToken: vi.fn().mockResolvedValue('token123'),
		});

		// First 2 shas should be fetched
		expect(fetchPRsForCommit).toHaveBeenCalledTimes(2);
		// Remaining 2 should not be cached
		expect(cache.get('sha3')).toBeUndefined();
		expect(cache.get('sha4')).toBeUndefined();
	});

	it('case 6: network failure → cache untouched for failed sha, other shas still processed', async () => {
		const cache = new PRCache();
		const pr200 = pr(200, false);
		const fetchPRsForCommit = vi
			.fn()
			.mockResolvedValueOnce(undefined) // sha1 fails
			.mockResolvedValueOnce([pr200]); // sha2 succeeds

		const input: PRLookupInput = {
			repoRoot: '/repo',
			shas: ['sha1', 'sha2'],
			cache,
		};

		const result = await lookupPRs(input, {
			resolveGitHubRemote: vi.fn().mockResolvedValue({ host: 'github', owner: 'o', repo: 'r' }),
			fetchPRsForCommit,
			getToken: vi.fn().mockResolvedValue('token123'),
		});

		// sha1 should not be in cache (network failure, don't poison)
		expect(cache.get('sha1')).toBeUndefined();
		// sha2 should be in result
		expect(result.get('sha2')).toEqual(pr200);
	});

	it('case 7: empty PR list → cache set to null for that sha', async () => {
		const cache = new PRCache();
		const fetchPRsForCommit = vi.fn().mockResolvedValue([]); // Empty list

		const input: PRLookupInput = {
			repoRoot: '/repo',
			shas: ['sha1'],
			cache,
		};

		const result = await lookupPRs(input, {
			resolveGitHubRemote: vi.fn().mockResolvedValue({ host: 'github', owner: 'o', repo: 'r' }),
			fetchPRsForCommit,
			getToken: vi.fn().mockResolvedValue('token123'),
		});

		expect(result.size).toBe(0);
		expect(cache.get('sha1')).toBe(null);
	});

	it('case 8: multiple PRs, one merged → merged one wins', async () => {
		const cache = new PRCache();
		const unmergedPR = pr(100, false);
		const mergedPR = pr(101, true);
		const fetchPRsForCommit = vi.fn().mockResolvedValue([unmergedPR, mergedPR]);

		const input: PRLookupInput = {
			repoRoot: '/repo',
			shas: ['sha1'],
			cache,
		};

		const result = await lookupPRs(input, {
			resolveGitHubRemote: vi.fn().mockResolvedValue({ host: 'github', owner: 'o', repo: 'r' }),
			fetchPRsForCommit,
			getToken: vi.fn().mockResolvedValue('token123'),
		});

		expect(result.get('sha1')).toEqual(mergedPR);
	});

	it('case 9: multiple PRs, none merged → first PR wins', async () => {
		const cache = new PRCache();
		const pr1 = pr(100, false);
		const pr2 = pr(101, false);
		const fetchPRsForCommit = vi.fn().mockResolvedValue([pr1, pr2]);

		const input: PRLookupInput = {
			repoRoot: '/repo',
			shas: ['sha1'],
			cache,
		};

		const result = await lookupPRs(input, {
			resolveGitHubRemote: vi.fn().mockResolvedValue({ host: 'github', owner: 'o', repo: 'r' }),
			fetchPRsForCommit,
			getToken: vi.fn().mockResolvedValue('token123'),
		});

		expect(result.get('sha1')).toEqual(pr1);
	});

	it('case 10: mixed cached + uncached → cached short-circuits, only uncached shas fetched', async () => {
		const cache = new PRCache();
		const cachedPR = pr(1, false);
		const fetchedPR = pr(2, false);
		cache.set('sha1', cachedPR);

		const fetchPRsForCommit = vi.fn().mockResolvedValue([fetchedPR]);

		const input: PRLookupInput = {
			repoRoot: '/repo',
			shas: ['sha1', 'sha2'],
			cache,
		};

		const result = await lookupPRs(input, {
			resolveGitHubRemote: vi.fn().mockResolvedValue({ host: 'github', owner: 'o', repo: 'r' }),
			fetchPRsForCommit,
			getToken: vi.fn().mockResolvedValue('token123'),
		});

		// Only sha2 should have been fetched (sha1 was cached)
		expect(fetchPRsForCommit).toHaveBeenCalledTimes(1);
		expect(fetchPRsForCommit).toHaveBeenCalledWith(expect.objectContaining({ sha: 'sha2' }));
		expect(result.get('sha1')).toEqual(cachedPR);
		expect(result.get('sha2')).toEqual(fetchedPR);
	});
});
