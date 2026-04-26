import { describe, it, expect } from 'vitest';
import { pickProvider, type PRProvider } from './provider';
import type { RemoteInfo } from '../remote';

const fake = (id: PRProvider['id'], host: RemoteInfo['host']): PRProvider => ({
	id,
	matches: (r) => r.host === host,
	fetchForCommit: async () => undefined,
	getToken: async () => undefined,
});

describe('pickProvider', () => {
	it('returns the first provider that matches', () => {
		const remote: RemoteInfo = { host: 'gitlab', hostname: 'gitlab.com', owner: 'o', repo: 'r' };
		const out = pickProvider(remote, [fake('github', 'github'), fake('gitlab', 'gitlab')]);
		expect(out?.id).toBe('gitlab');
	});

	it('returns undefined when no provider matches', () => {
		const remote: RemoteInfo = {
			host: 'github',
			hostname: 'github.com',
			owner: 'o',
			repo: 'r',
		};
		expect(pickProvider(remote, [fake('gitlab', 'gitlab')])).toBeUndefined();
	});
});
