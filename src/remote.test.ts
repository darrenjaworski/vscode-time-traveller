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

	it('returns undefined for unknown hosts', () => {
		expect(parseRemoteUrl('git@example.com:owner/repo.git')).toBeUndefined();
	});

	it('returns undefined when the path has no owner/repo split', () => {
		expect(parseRemoteUrl('git@github.com:justonename')).toBeUndefined();
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
