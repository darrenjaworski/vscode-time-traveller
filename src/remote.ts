/**
 * Pure helpers for translating a git remote URL into a browse-the-commit URL
 * on the corresponding hosted platform. Supports the common web hosts with
 * their standard `/commit/<sha>` paths.
 *
 * Kept free of `vscode` imports so the parsing logic is fully unit-testable.
 */

export type RemoteHost = 'github' | 'gitlab' | 'bitbucket' | 'github-enterprise' | 'unknown';

export interface RemoteInfo {
	host: RemoteHost;
	hostname: string;
	owner: string;
	repo: string;
	/** Used by Enterprise / self-hosted providers. */
	baseUrl?: string;
}

export interface ParseOptions {
	enterpriseHosts?: Record<string, 'github-enterprise' | 'gitlab' | 'bitbucket'>;
}

const HOSTNAME_PATTERNS: Array<{ test: RegExp; host: RemoteHost }> = [
	{ test: /(^|\.)github\.com$/i, host: 'github' },
	{ test: /(^|\.)gitlab\.com$/i, host: 'gitlab' },
	{ test: /(^|\.)bitbucket\.org$/i, host: 'bitbucket' },
];

export function parseRemoteUrl(url: string, opts: ParseOptions = {}): RemoteInfo | undefined {
	const trimmed = url.trim();
	if (!trimmed) return undefined;

	// SSH form: git@host:owner/repo(.git)?
	const ssh = trimmed.match(/^[\w.-]+@([^:]+):(.+?)(?:\.git)?\/?$/);
	if (ssh) {
		return fromHostAndPath(ssh[1], ssh[2], opts);
	}

	// https / ssh://, git://, http:// forms
	const url2 = trimmed.match(
		/^(?:[a-z][\w+.-]*:\/\/)(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/i,
	);
	if (url2) {
		return fromHostAndPath(url2[1], url2[2], opts);
	}

	return undefined;
}

function fromHostAndPath(
	hostname: string,
	rawPath: string,
	opts: ParseOptions,
): RemoteInfo | undefined {
	const parts = rawPath
		.replace(/\.git$/, '')
		.split('/')
		.filter(Boolean);
	if (parts.length < 2) return undefined;
	const owner = parts[0];
	const repo = parts.slice(1).join('/');

	// Check cloud hosts first
	const match = HOSTNAME_PATTERNS.find((p) => p.test.test(hostname));
	if (match) {
		return { host: match.host, hostname, owner, repo };
	}

	// Check enterprise config
	const ent = opts.enterpriseHosts?.[hostname];
	if (ent === 'github-enterprise') {
		return {
			host: 'github-enterprise',
			hostname,
			owner,
			repo,
			baseUrl: `https://${hostname}/api/v3`,
		};
	}
	if (ent === 'gitlab') {
		return {
			host: 'gitlab',
			hostname,
			owner,
			repo,
			baseUrl: `https://${hostname}`,
		};
	}
	if (ent === 'bitbucket') {
		return { host: 'bitbucket', hostname, owner, repo };
	}

	// Fallback to unknown
	return { host: 'unknown', hostname, owner, repo };
}

export function buildCommitUrl(info: RemoteInfo, sha: string): string {
	const base = `https://${info.hostname}/${info.owner}/${info.repo}`;
	// All three of github/gitlab/bitbucket use /commit/<sha>.
	// Bitbucket also accepts /commits/<sha>, but /commit redirects.
	return `${base}/commit/${sha}`;
}
