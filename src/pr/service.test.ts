import { describe, it, expect, vi } from 'vitest';
import { lookupPRs, type PRLookupDeps, type PRLookupInput } from './service';
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
});
