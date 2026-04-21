/**
 * GitHub REST client for "which PR introduced this commit?" lookups.
 *
 * The network-touching entry point is `fetchPRsForCommit`; everything else in
 * this file is pure so the URL shape and JSON mapping are testable without a
 * live network. GitHub's `/repos/{o}/{r}/commits/{sha}/pulls` endpoint returns
 * an array of PRs associated with the commit — typically 0 or 1, occasionally
 * more (e.g. a commit cherry-picked into multiple branches).
 *
 * Enterprise GitHub is out of scope for v1; the hostname check in
 * `src/remote.ts` only recognises `github.com`. If/when we support GHE, this
 * module will also need a configurable `baseUrl`.
 */

export interface PRSummary {
	number: number;
	title: string;
	body: string;
	url: string;
	state: string;
	merged: boolean;
}

export const GITHUB_API_BASE = 'https://api.github.com';

export function buildCommitPRsUrl(owner: string, repo: string, sha: string): string {
	// Path-segment-encode each piece so owners like `my org` (legal per RFC
	// 3986) don't break the URL. SHA is already hex so encoding is a no-op.
	return `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
		repo,
	)}/commits/${encodeURIComponent(sha)}/pulls`;
}

/**
 * Map GitHub's JSON shape to our compact `PRSummary`. Accepts either the raw
 * array or an envelope we've pre-parsed. Ignores entries without a number
 * (shouldn't happen, but belt-and-braces).
 */
export function parsePRsResponse(raw: unknown): PRSummary[] {
	if (!Array.isArray(raw)) return [];
	const out: PRSummary[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const obj = item as Record<string, unknown>;
		if (typeof obj.number !== 'number') continue;
		out.push({
			number: obj.number,
			title: typeof obj.title === 'string' ? obj.title : '',
			body: typeof obj.body === 'string' ? obj.body : '',
			url: typeof obj.html_url === 'string' ? obj.html_url : '',
			state: typeof obj.state === 'string' ? obj.state : '',
			merged: obj.merged_at != null,
		});
	}
	return out;
}

export interface FetchPRsInput {
	owner: string;
	repo: string;
	sha: string;
	/** GitHub OAuth token from `vscode.authentication`, if the user is signed
	 * in. Omitted calls still work for public repos but are rate-limited at
	 * 60/hr per IP. */
	token?: string;
	/** Injected for tests. */
	fetchImpl?: typeof fetch;
}

/**
 * Fetches PRs associated with a single commit. Returns `undefined` on network
 * failure, non-2xx status, or JSON parse error — callers should treat
 * "unknown" as "don't mention PRs for this commit" rather than surfacing the
 * error, since PR context is a nice-to-have.
 */
export async function fetchPRsForCommit(input: FetchPRsInput): Promise<PRSummary[] | undefined> {
	const { owner, repo, sha, token } = input;
	const fetchImpl = input.fetchImpl ?? fetch;
	const headers: Record<string, string> = {
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28',
		'User-Agent': 'vscode-time-traveller',
	};
	if (token) headers.Authorization = `Bearer ${token}`;
	try {
		const response = await fetchImpl(buildCommitPRsUrl(owner, repo, sha), { headers });
		if (!response.ok) return undefined;
		const json = (await response.json()) as unknown;
		return parsePRsResponse(json);
	} catch {
		return undefined;
	}
}
