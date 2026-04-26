import { describe, expect, it } from 'vitest';
import {
	adaptBitbucketPR,
	buildCommitPRsUrl,
	parsePRsResponse,
	type BitbucketPR,
} from './bitbucket';

describe('buildCommitPRsUrl', () => {
	it('constructs correct URL for bitbucket.org', () => {
		const url = buildCommitPRsUrl('workspace', 'repo', 'abc123');
		expect(url).toBe(
			'https://api.bitbucket.org/2.0/repositories/workspace/repo/commit/abc123/pullrequests',
		);
	});

	it('URL-encodes workspace and repo segments', () => {
		const url = buildCommitPRsUrl('my workspace', 'my repo', 'abc123');
		expect(url).toContain('repositories/my%20workspace/my%20repo');
	});
});

describe('adaptBitbucketPR', () => {
	it('maps a merged PR to a PRSummary', () => {
		const pr = {
			id: 7,
			title: 'Refactor',
			description: 'desc',
			state: 'MERGED' as const,
			links: { html: { href: 'https://bitbucket.org/o/r/pull-requests/7' } },
			author: { display_name: 'Alice', nickname: 'alice' },
		};
		const out = adaptBitbucketPR(pr);
		expect(out.number).toBe(7);
		expect(out.merged).toBe(true);
		expect(out.state).toBe('merged');
		expect(out.author).toBe('alice');
	});

	it('uses display_name when nickname is not present', () => {
		const pr = {
			id: 5,
			title: 'Feature',
			description: '',
			state: 'OPEN' as const,
			links: { html: { href: 'https://bitbucket.org/o/r/pull-requests/5' } },
			author: { display_name: 'Bob' },
		};
		const out = adaptBitbucketPR(pr);
		expect(out.author).toBe('Bob');
	});

	it('maps OPEN state to open', () => {
		const pr = {
			id: 1,
			title: 'WIP',
			description: '',
			state: 'OPEN' as const,
			links: { html: { href: 'https://bitbucket.org/o/r/pull-requests/1' } },
			author: { display_name: 'Dev' },
		};
		const out = adaptBitbucketPR(pr);
		expect(out.state).toBe('open');
		expect(out.merged).toBe(false);
	});

	it('maps DECLINED state to closed', () => {
		const pr = {
			id: 2,
			title: 'Rejected',
			description: '',
			state: 'DECLINED' as const,
			links: { html: { href: 'https://bitbucket.org/o/r/pull-requests/2' } },
			author: { display_name: 'Dev' },
		};
		const out = adaptBitbucketPR(pr);
		expect(out.state).toBe('closed');
		expect(out.merged).toBe(false);
	});

	it('maps SUPERSEDED state to closed', () => {
		const pr = {
			id: 3,
			title: 'Old',
			description: '',
			state: 'SUPERSEDED' as const,
			links: { html: { href: 'https://bitbucket.org/o/r/pull-requests/3' } },
			author: { display_name: 'Dev' },
		};
		const out = adaptBitbucketPR(pr);
		expect(out.state).toBe('closed');
		expect(out.merged).toBe(false);
	});

	it('defaults missing strings to empty', () => {
		const pr: Partial<BitbucketPR> = {
			id: 99,
			state: 'OPEN' as const,
			links: { html: { href: '' } },
			author: { display_name: 'Someone' },
		};
		const out = adaptBitbucketPR(pr);
		expect(out).toMatchObject({ title: '', body: '' });
	});
});

describe('BitbucketProvider', () => {
	it('matches bitbucket host', async () => {
		const { BitbucketProvider } = await import('./bitbucket');
		const provider = new BitbucketProvider();
		expect(
			provider.matches({
				host: 'bitbucket',
				hostname: 'bitbucket.org',
				owner: 'team',
				repo: 'repo',
			}),
		).toBe(true);
	});

	it('does not match other hosts', async () => {
		const { BitbucketProvider } = await import('./bitbucket');
		const provider = new BitbucketProvider();
		expect(
			provider.matches({
				host: 'github',
				hostname: 'github.com',
				owner: 'o',
				repo: 'r',
			}),
		).toBe(false);
	});

	it('has correct provider id', async () => {
		const { BitbucketProvider } = await import('./bitbucket');
		expect(new BitbucketProvider().id).toBe('bitbucket');
	});
});

describe('parsePRsResponse', () => {
	it('returns [] for non-envelope input', () => {
		expect(parsePRsResponse(null)).toEqual([]);
		expect(parsePRsResponse([])).toEqual([]);
		expect(parsePRsResponse('oops')).toEqual([]);
	});

	it('extracts values from the envelope', () => {
		const raw = {
			values: [
				{
					id: 42,
					title: 'Fix login',
					description: 'Restores the redirect flow.',
					state: 'MERGED',
					links: { html: { href: 'https://bitbucket.org/o/r/pull-requests/42' } },
					author: { display_name: 'Jane', nickname: 'jane' },
				},
			],
		};
		expect(parsePRsResponse(raw)).toEqual([
			{
				number: 42,
				title: 'Fix login',
				body: 'Restores the redirect flow.',
				url: 'https://bitbucket.org/o/r/pull-requests/42',
				state: 'merged',
				merged: true,
				author: 'jane',
			},
		]);
	});

	it('handles empty values array', () => {
		expect(parsePRsResponse({ values: [] })).toEqual([]);
	});

	it('handles missing values field', () => {
		expect(parsePRsResponse({})).toEqual([]);
	});

	it('skips entries without a numeric id', () => {
		const raw = {
			values: [
				{ title: 'no id' },
				{
					id: 7,
					title: 'ok',
					state: 'MERGED',
					links: { html: { href: '' } },
					author: { display_name: 'Dev' },
				},
			],
		};
		expect(parsePRsResponse(raw)).toHaveLength(1);
		expect(parsePRsResponse(raw)[0].number).toBe(7);
	});
});
