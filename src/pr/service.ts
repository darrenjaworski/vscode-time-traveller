import * as vscode from 'vscode';
import { findRepository } from '../git/api';
import { parseRemoteUrl, type RemoteInfo } from '../remote';
import { PRCache } from './cache';
import { fetchPRsForCommit, type PRSummary } from './github';

/**
 * Resolve the first GitHub remote for a repo root. Reaches through `unknown`
 * for the remotes field — the minimal Git API type in `src/git/api.ts` doesn't
 * declare it, matching the pattern used in `src/history/view.ts`.
 */
async function resolveGitHubRemote(repoRoot: string): Promise<RemoteInfo | undefined> {
	const repo = await findRepository(vscode.Uri.file(repoRoot));
	const remotes = (
		repo as unknown as { state?: { remotes?: Array<{ fetchUrl?: string; pushUrl?: string }> } }
	)?.state?.remotes;
	if (!remotes) return undefined;
	for (const remote of remotes) {
		const url = remote.fetchUrl ?? remote.pushUrl;
		if (!url) continue;
		const info = parseRemoteUrl(url);
		if (info?.host === 'github') return info;
	}
	return undefined;
}

/**
 * Try to get the user's GitHub session without triggering a sign-in prompt —
 * `createIfNone: false` keeps the chat experience silent for users who haven't
 * opted in. Unauthenticated API calls still work against public repos, just
 * rate-limited at 60/hr/IP.
 */
async function getGitHubToken(): Promise<string | undefined> {
	try {
		const session = await vscode.authentication.getSession('github', ['repo'], {
			createIfNone: false,
			silent: true,
		});
		return session?.accessToken;
	} catch {
		return undefined;
	}
}

export interface PRLookupInput {
	repoRoot: string;
	shas: string[];
	cache: PRCache;
	/** Hard cap on how many commits we fire network calls for in one request.
	 * Anything beyond this is skipped (not cached) so a later, narrower query
	 * might still fetch it. */
	limit?: number;
}

export interface PRLookupDeps {
	resolveGitHubRemote: (repoRoot: string) => Promise<RemoteInfo | undefined>;
	fetchPRsForCommit: (args: {
		owner: string;
		repo: string;
		sha: string;
		token?: string;
	}) => Promise<PRSummary[] | undefined>;
	getToken: () => Promise<string | undefined>;
}

/**
 * Resolve PR context for a batch of commits. Returns a map of SHA → PRSummary
 * for commits that (a) live in a GitHub-backed repo and (b) are associated
 * with at least one PR. Silently degrades when auth is missing, the remote
 * isn't GitHub, or the network is down.
 *
 * When GitHub returns multiple PRs for a commit (cherry-picked into several
 * branches), we keep the merged one if present, otherwise the first.
 */
export async function lookupPRs(
	input: PRLookupInput,
	deps?: Partial<PRLookupDeps>,
): Promise<Map<string, PRSummary>> {
	const defaultDeps: PRLookupDeps = {
		resolveGitHubRemote: async (repoRoot) => resolveGitHubRemote(repoRoot),
		fetchPRsForCommit: fetchPRsForCommit,
		getToken: getGitHubToken,
	};
	const resolvedDeps = { ...defaultDeps, ...deps };

	const out = new Map<string, PRSummary>();
	const { repoRoot, cache, shas } = input;
	const limit = input.limit ?? 5;
	if (shas.length === 0) return out;

	// Split into cached (instant) and pending (needs network).
	const toFetch: string[] = [];
	for (const sha of shas) {
		const hit = cache.get(sha);
		if (hit === undefined) {
			toFetch.push(sha);
			continue;
		}
		if (hit !== null) out.set(sha, hit);
	}
	if (toFetch.length === 0) return out;

	const remote = await resolvedDeps.resolveGitHubRemote(repoRoot);
	if (!remote) {
		// Record nulls so we don't keep re-checking the remote; the cache is
		// session-scoped so this is harmless.
		for (const sha of toFetch) cache.set(sha, null);
		return out;
	}

	const token = await resolvedDeps.getToken();
	const capped = toFetch.slice(0, limit);
	await Promise.all(
		capped.map(async (sha) => {
			const prs = await resolvedDeps.fetchPRsForCommit({
				owner: remote.owner,
				repo: remote.repo,
				sha,
				token,
			});
			if (prs === undefined) {
				// Network failure — don't poison the cache; let future runs retry.
				return;
			}
			if (prs.length === 0) {
				cache.set(sha, null);
				return;
			}
			const chosen = prs.find((p) => p.merged) ?? prs[0];
			cache.set(sha, chosen);
			out.set(sha, chosen);
		}),
	);
	return out;
}
