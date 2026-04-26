import * as vscode from 'vscode';
import { findRepository } from '../git/api';
import { parseRemoteUrl, type RemoteInfo } from '../remote';
import { PRCache } from './cache';
import type { PRSummary } from './github';
import { GitHubProvider } from './github';
import { GitLabProvider } from './gitlab';
import { pickProvider, type PRProvider } from './provider';

/**
 * Resolve the first GitHub remote for a repo root. Reaches through `unknown`
 * for the remotes field — the minimal Git API type in `src/git/api.ts` doesn't
 * declare it, matching the pattern used in `src/history/view.ts`.
 */
async function resolveRemote(repoRoot: string): Promise<RemoteInfo | undefined> {
	const repo = await findRepository(vscode.Uri.file(repoRoot));
	const remotes = (
		repo as unknown as { state?: { remotes?: Array<{ fetchUrl?: string; pushUrl?: string }> } }
	)?.state?.remotes;
	if (!remotes) return undefined;
	for (const remote of remotes) {
		const url = remote.fetchUrl ?? remote.pushUrl;
		if (!url) continue;
		const info = parseRemoteUrl(url);
		if (info) return info;
	}
	return undefined;
}

export const DEFAULT_PROVIDERS: PRProvider[] = [new GitHubProvider(), new GitLabProvider()];

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
	resolveRemote: (repoRoot: string) => Promise<RemoteInfo | undefined>;
	providers: PRProvider[];
}

/**
 * Resolve PR context for a batch of commits. Returns a map of SHA → PRSummary
 * for commits that (a) live in a supported-provider remote and (b) are associated
 * with at least one PR. Silently degrades when auth is missing, the remote
 * isn't supported, or the network is down.
 *
 * When a provider returns multiple PRs for a commit (cherry-picked into several
 * branches), we keep the merged one if present, otherwise the first.
 */
export async function lookupPRs(
	input: PRLookupInput,
	deps?: Partial<PRLookupDeps>,
): Promise<Map<string, PRSummary>> {
	const defaultDeps: PRLookupDeps = {
		resolveRemote: async (repoRoot) => resolveRemote(repoRoot),
		providers: DEFAULT_PROVIDERS,
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

	const remote = await resolvedDeps.resolveRemote(repoRoot);
	if (!remote) {
		// Record nulls so we don't keep re-checking the remote; the cache is
		// session-scoped so this is harmless.
		for (const sha of toFetch) cache.set(sha, null);
		return out;
	}

	const provider = pickProvider(remote, resolvedDeps.providers);
	if (!provider) {
		// No matching provider for this remote type
		for (const sha of toFetch) cache.set(sha, null);
		return out;
	}

	const token = await provider.getToken();
	const capped = toFetch.slice(0, limit);
	await Promise.all(
		capped.map(async (sha) => {
			const prs = await provider.fetchForCommit({ remote, sha, token });
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
