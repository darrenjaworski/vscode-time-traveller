import { describe, expect, it } from 'vitest';
import { adaptGitLabMR, buildCommitMRsUrl, GITLAB_API_BASE, parseMRsResponse } from './gitlab';

describe('buildCommitMRsUrl', () => {
	it('constructs correct URL for gitlab.com', () => {
		const url = buildCommitMRsUrl('owner/repo', 'abc123');
		expect(url).toBe(
			`${GITLAB_API_BASE}/projects/owner%2Frepo/repository/commits/abc123/merge_requests`,
		);
	});

	it('URL-encodes the project ID', () => {
		const url = buildCommitMRsUrl('my org/my repo', 'abc123');
		expect(url).toContain('my%20org%2Fmy%20repo');
	});

	it('supports custom baseUrl', () => {
		const url = buildCommitMRsUrl('owner/repo', 'abc123', 'https://gitlab.example.com/api/v4');
		expect(url).toBe(
			'https://gitlab.example.com/api/v4/projects/owner%2Frepo/repository/commits/abc123/merge_requests',
		);
	});
});

describe('adaptGitLabMR', () => {
	it('maps merged state correctly', () => {
		const mr = {
			iid: 42,
			title: 'Fix login',
			description: 'Restores the redirect flow.',
			state: 'merged',
			web_url: 'https://gitlab.com/o/r/-/merge_requests/42',
			author: { name: 'Jane' },
		};
		expect(adaptGitLabMR(mr)).toEqual({
			number: 42,
			title: 'Fix login',
			body: 'Restores the redirect flow.',
			url: 'https://gitlab.com/o/r/-/merge_requests/42',
			state: 'merged',
			merged: true,
		});
	});

	it('maps opened state to open', () => {
		const mr = {
			iid: 5,
			title: 'Feature',
			description: '',
			state: 'opened',
			web_url: 'https://gitlab.com/o/r/-/merge_requests/5',
			author: { name: 'John' },
		};
		expect(adaptGitLabMR(mr)).toEqual({
			number: 5,
			title: 'Feature',
			body: '',
			url: 'https://gitlab.com/o/r/-/merge_requests/5',
			state: 'open',
			merged: false,
		});
	});

	it('marks merged=false for opened state', () => {
		const mr = {
			iid: 1,
			title: 'WIP',
			description: '',
			state: 'opened',
			web_url: 'https://gitlab.com/o/r/-/merge_requests/1',
			author: { name: 'Dev' },
		};
		expect(adaptGitLabMR(mr).merged).toBe(false);
	});

	it('marks merged=true only for merged state', () => {
		const mr = {
			iid: 2,
			title: 'Done',
			description: '',
			state: 'merged',
			web_url: 'https://gitlab.com/o/r/-/merge_requests/2',
			author: { name: 'Dev' },
		};
		expect(adaptGitLabMR(mr).merged).toBe(true);
	});
});

describe('parseMRsResponse', () => {
	it('returns [] for non-array input', () => {
		expect(parseMRsResponse(null)).toEqual([]);
		expect(parseMRsResponse({})).toEqual([]);
		expect(parseMRsResponse('oops')).toEqual([]);
	});

	it('maps GitLab MR fields to PRSummary', () => {
		const raw = [
			{
				iid: 42,
				title: 'Fix login',
				description: 'Restores the redirect flow.',
				state: 'merged',
				web_url: 'https://gitlab.com/o/r/-/merge_requests/42',
				author: { name: 'Jane' },
			},
		];
		expect(parseMRsResponse(raw)).toEqual([
			{
				number: 42,
				title: 'Fix login',
				body: 'Restores the redirect flow.',
				url: 'https://gitlab.com/o/r/-/merge_requests/42',
				state: 'merged',
				merged: true,
			},
		]);
	});

	it('skips entries without iid', () => {
		const raw = [
			{ title: 'no iid' },
			{ iid: 7, title: 'ok', state: 'merged', web_url: '', description: '' },
		];
		expect(parseMRsResponse(raw)).toHaveLength(1);
		expect(parseMRsResponse(raw)[0].number).toBe(7);
	});

	it('converts opened state to open', () => {
		const raw = [
			{
				iid: 1,
				title: 'Feature',
				description: '',
				state: 'opened',
				web_url: 'https://gitlab.com/o/r/-/merge_requests/1',
				author: { name: 'Dev' },
			},
		];
		const result = parseMRsResponse(raw);
		expect(result[0].state).toBe('open');
	});

	it('defaults missing strings to empty', () => {
		const raw = [{ iid: 5, state: 'opened' }];
		expect(parseMRsResponse(raw)[0]).toMatchObject({ title: '', body: '', url: '' });
	});
});

describe('GitLabProvider', () => {
	it('matches gitlab host', async () => {
		const { GitLabProvider } = await import('./gitlab');
		const provider = new GitLabProvider();
		expect(
			provider.matches({
				host: 'gitlab',
				hostname: 'gitlab.com',
				owner: 'o',
				repo: 'r',
			}),
		).toBe(true);
	});

	it('does not match other hosts', async () => {
		const { GitLabProvider } = await import('./gitlab');
		const provider = new GitLabProvider();
		expect(
			provider.matches({
				host: 'github',
				hostname: 'github.com',
				owner: 'o',
				repo: 'r',
			}),
		).toBe(false);
	});
});
