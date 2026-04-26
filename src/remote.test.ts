import { describe, expect, it } from 'vitest';
import { buildCommitUrl, parseRemoteUrl } from './remote';

describe('parseRemoteUrl — SSH form', () => {
	it('parses github.com SSH URLs', () => {
		expect(parseRemoteUrl('git@github.com:owner/repo.git')).toEqual({
			host: 'github',
			hostname: 'github.com',
			owner: 'owner',
			repo: 'repo',
		});
	});

	it('tolerates missing .git suffix', () => {
		expect(parseRemoteUrl('git@github.com:owner/repo')).toMatchObject({ repo: 'repo' });
	});

	it('parses gitlab.com and bitbucket.org SSH URLs', () => {
		expect(parseRemoteUrl('git@gitlab.com:owner/repo.git')?.host).toBe('gitlab');
		expect(parseRemoteUrl('git@bitbucket.org:owner/repo.git')?.host).toBe('bitbucket');
	});

	it('keeps nested group paths as part of the repo (gitlab subgroups)', () => {
		expect(parseRemoteUrl('git@gitlab.com:group/sub/repo.git')).toMatchObject({
			owner: 'group',
			repo: 'sub/repo',
		});
	});
});

describe('parseRemoteUrl — https/git:// form', () => {
	it('parses https URLs', () => {
		expect(parseRemoteUrl('https://github.com/owner/repo.git')).toMatchObject({
			host: 'github',
			owner: 'owner',
			repo: 'repo',
		});
	});

	it('parses https URLs without .git', () => {
		expect(parseRemoteUrl('https://github.com/owner/repo')).toMatchObject({ repo: 'repo' });
	});

	it('parses ssh:// URLs', () => {
		expect(parseRemoteUrl('ssh://git@github.com/owner/repo.git')).toMatchObject({
			host: 'github',
			owner: 'owner',
		});
	});

	it('ignores user-info components', () => {
		expect(parseRemoteUrl('https://token@github.com/owner/repo.git')).toMatchObject({
			owner: 'owner',
		});
	});
});

describe('parseRemoteUrl — unsupported input', () => {
	it('returns undefined for empty input', () => {
		expect(parseRemoteUrl('')).toBeUndefined();
		expect(parseRemoteUrl('   ')).toBeUndefined();
	});

	it('returns unknown host info for unrecognized cloud hosts', () => {
		expect(parseRemoteUrl('git@example.com:owner/repo.git')).toMatchObject({
			host: 'unknown',
			owner: 'owner',
			repo: 'repo',
		});
	});

	it('returns undefined when the path has no owner/repo split', () => {
		expect(parseRemoteUrl('git@github.com:justonename')).toBeUndefined();
	});
});

describe('parseRemoteUrl — multi-host', () => {
	it('detects gitlab.com', () => {
		expect(parseRemoteUrl('git@gitlab.com:group/project.git')).toEqual({
			host: 'gitlab',
			hostname: 'gitlab.com',
			owner: 'group',
			repo: 'project',
		});
	});

	it('detects bitbucket.org', () => {
		expect(parseRemoteUrl('https://bitbucket.org/team/repo.git')).toEqual({
			host: 'bitbucket',
			hostname: 'bitbucket.org',
			owner: 'team',
			repo: 'repo',
		});
	});

	it('returns github-enterprise when host is in enterprise config', () => {
		const out = parseRemoteUrl('git@git.acme.corp:team/repo.git', {
			enterpriseHosts: { 'git.acme.corp': 'github-enterprise' },
		});
		expect(out?.host).toBe('github-enterprise');
		expect(out?.baseUrl).toBe('https://git.acme.corp/api/v3');
	});

	it('returns gitlab when host is in enterprise config as gitlab', () => {
		const out = parseRemoteUrl('git@git.acme.corp:team/repo.git', {
			enterpriseHosts: { 'git.acme.corp': 'gitlab' },
		});
		expect(out?.host).toBe('gitlab');
		expect(out?.baseUrl).toBe('https://git.acme.corp');
	});

	it('returns bitbucket for enterprise host without baseUrl', () => {
		const out = parseRemoteUrl('git@bitbucket.acme.corp:team/repo.git', {
			enterpriseHosts: { 'bitbucket.acme.corp': 'bitbucket' },
		});
		expect(out?.host).toBe('bitbucket');
		expect(out?.baseUrl).toBeUndefined();
	});

	it('returns unknown for unrecognized host', () => {
		const out = parseRemoteUrl('git@example.com:team/repo.git', {});
		expect(out?.host).toBe('unknown');
		expect(out?.owner).toBe('team');
		expect(out?.repo).toBe('repo');
	});
});

describe('buildCommitUrl', () => {
	it('builds /commit/<sha> URLs', () => {
		const info = {
			host: 'github' as const,
			hostname: 'github.com',
			owner: 'owner',
			repo: 'repo',
		};
		expect(buildCommitUrl(info, 'abc1234')).toBe('https://github.com/owner/repo/commit/abc1234');
	});
});
