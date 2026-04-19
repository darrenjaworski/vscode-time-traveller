/**
 * Pure helpers for translating a git remote URL into a browse-the-commit URL
 * on the corresponding hosted platform. Supports the common web hosts with
 * their standard `/commit/<sha>` paths.
 *
 * Kept free of `vscode` imports so the parsing logic is fully unit-testable.
 */

export interface RemoteInfo {
	host: 'github' | 'gitlab' | 'bitbucket';
	hostname: string;
	owner: string;
	repo: string;
}

const HOSTNAME_PATTERNS: Array<{ test: RegExp; host: RemoteInfo['host'] }> = [
	{ test: /(^|\.)github\.com$/i, host: 'github' },
	{ test: /(^|\.)gitlab\.com$/i, host: 'gitlab' },
	{ test: /(^|\.)bitbucket\.org$/i, host: 'bitbucket' },
];

export function parseRemoteUrl(url: string): RemoteInfo | undefined {
	const trimmed = url.trim();
	if (!trimmed) return undefined;

	// SSH form: git@host:owner/repo(.git)?
	const ssh = trimmed.match(/^[\w.-]+@([^:]+):(.+?)(?:\.git)?\/?$/);
	if (ssh) {
		return fromHostAndPath(ssh[1], ssh[2]);
	}

	// https / ssh://, git://, http:// forms
	const url2 = trimmed.match(
		/^(?:[a-z][\w+.-]*:\/\/)(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/i,
	);
	if (url2) {
		return fromHostAndPath(url2[1], url2[2]);
	}

	return undefined;
}

function fromHostAndPath(hostname: string, rawPath: string): RemoteInfo | undefined {
	const parts = rawPath
		.replace(/\.git$/, '')
		.split('/')
		.filter(Boolean);
	if (parts.length < 2) return undefined;
	const owner = parts[0];
	const repo = parts.slice(1).join('/');
	const match = HOSTNAME_PATTERNS.find((p) => p.test.test(hostname));
	if (!match) return undefined;
	return { host: match.host, hostname, owner, repo };
}

export function buildCommitUrl(info: RemoteInfo, sha: string): string {
	const base = `https://${info.hostname}/${info.owner}/${info.repo}`;
	// All three of github/gitlab/bitbucket use /commit/<sha>.
	// Bitbucket also accepts /commits/<sha>, but /commit redirects.
	return `${base}/commit/${sha}`;
}
