import { describe, expect, it } from 'vitest';
import { GitHubEnterpriseProvider } from './gheServer';

describe('GitHubEnterpriseProvider', () => {
	it('has id "github-enterprise"', () => {
		const provider = new GitHubEnterpriseProvider();
		expect(provider.id).toBe('github-enterprise');
	});

	it('matches github-enterprise host', () => {
		const provider = new GitHubEnterpriseProvider();
		expect(
			provider.matches({
				host: 'github-enterprise',
				hostname: 'ghe.example.com',
				owner: 'o',
				repo: 'r',
			}),
		).toBe(true);
	});

	it('does not match other hosts', () => {
		const provider = new GitHubEnterpriseProvider();
		expect(
			provider.matches({
				host: 'github',
				hostname: 'github.com',
				owner: 'o',
				repo: 'r',
			}),
		).toBe(false);
		expect(
			provider.matches({
				host: 'gitlab',
				hostname: 'gitlab.com',
				owner: 'o',
				repo: 'r',
			}),
		).toBe(false);
	});
});
