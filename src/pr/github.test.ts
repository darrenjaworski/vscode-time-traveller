import { describe, expect, it, vi } from 'vitest';
import { buildCommitPRsUrl, fetchPRsForCommit, GITHUB_API_BASE, parsePRsResponse } from './github';

describe('buildCommitPRsUrl', () => {
	it('hits /repos/{owner}/{repo}/commits/{sha}/pulls', () => {
		expect(buildCommitPRsUrl('anthropics', 'demo', 'abc123')).toBe(
			`${GITHUB_API_BASE}/repos/anthropics/demo/commits/abc123/pulls`,
		);
	});

	it('url-encodes owner and repo segments', () => {
		const url = buildCommitPRsUrl('some org', 'repo name', 'abc');
		expect(url).toContain('/repos/some%20org/repo%20name/');
	});
});

describe('parsePRsResponse', () => {
	it('returns [] for non-array input', () => {
		expect(parsePRsResponse(null)).toEqual([]);
		expect(parsePRsResponse({})).toEqual([]);
		expect(parsePRsResponse('oops')).toEqual([]);
	});

	it('maps the fields we care about', () => {
		const raw = [
			{
				number: 42,
				title: 'Fix login',
				body: 'Restores the redirect flow.',
				html_url: 'https://github.com/o/r/pull/42',
				state: 'closed',
				merged_at: '2026-04-01T00:00:00Z',
			},
		];
		expect(parsePRsResponse(raw)).toEqual([
			{
				number: 42,
				title: 'Fix login',
				body: 'Restores the redirect flow.',
				url: 'https://github.com/o/r/pull/42',
				state: 'closed',
				merged: true,
			},
		]);
	});

	it('marks merged=false when merged_at is null', () => {
		const raw = [{ number: 1, title: 't', body: '', html_url: '', state: 'open', merged_at: null }];
		expect(parsePRsResponse(raw)[0].merged).toBe(false);
	});

	it('skips entries without a numeric `number`', () => {
		const raw = [{ title: 'no number' }, { number: 7, title: 'ok' }];
		expect(parsePRsResponse(raw)).toHaveLength(1);
		expect(parsePRsResponse(raw)[0].number).toBe(7);
	});

	it('defaults missing strings to empty rather than undefined', () => {
		const raw = [{ number: 5 }];
		expect(parsePRsResponse(raw)[0]).toMatchObject({ title: '', body: '', url: '', state: '' });
	});
});

describe('fetchPRsForCommit', () => {
	function mockResponse(body: unknown, ok = true, status = 200) {
		return {
			ok,
			status,
			json: vi.fn(async () => body),
		} as unknown as Response;
	}

	it('sends Accept + api-version headers and parses the body', async () => {
		const fetchImpl = vi.fn(async () =>
			mockResponse([{ number: 1, title: 't', body: '', html_url: '', state: 'open' }]),
		) as unknown as typeof fetch;
		const out = await fetchPRsForCommit({
			owner: 'o',
			repo: 'r',
			sha: 'abc',
			fetchImpl,
		});
		expect(out).toHaveLength(1);
		expect(out![0].number).toBe(1);
		const headers = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
		expect(headers.Accept).toBe('application/vnd.github+json');
		expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
		expect(headers.Authorization).toBeUndefined();
	});

	it('adds a Bearer Authorization header when a token is provided', async () => {
		const fetchImpl = vi.fn(async () => mockResponse([])) as unknown as typeof fetch;
		await fetchPRsForCommit({ owner: 'o', repo: 'r', sha: 'abc', token: 'tok', fetchImpl });
		const headers = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
		expect(headers.Authorization).toBe('Bearer tok');
	});

	it('returns undefined on non-2xx responses', async () => {
		const fetchImpl = vi.fn(async () => mockResponse(null, false, 404)) as unknown as typeof fetch;
		const out = await fetchPRsForCommit({ owner: 'o', repo: 'r', sha: 'x', fetchImpl });
		expect(out).toBeUndefined();
	});

	it('returns undefined when fetch throws', async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error('net down');
		}) as unknown as typeof fetch;
		const out = await fetchPRsForCommit({ owner: 'o', repo: 'r', sha: 'x', fetchImpl });
		expect(out).toBeUndefined();
	});
});
