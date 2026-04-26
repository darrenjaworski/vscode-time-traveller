/**
 * Bitbucket Cloud REST client for "which PR introduced this commit?" lookups.
 *
 * The network-touching entry point is `fetchPRsForCommit`; everything else in
 * this file is pure so the URL shape and JSON mapping are testable without a
 * live network. Bitbucket's `/repositories/{workspace}/{repo}/commit/{sha}/pullrequests`
 * endpoint returns a paginated response envelope with a `values` array of PRs.
 *
 * Auth uses HTTP Basic auth with app password from the timeTraveller.bitbucketAppPassword
 * setting (username is not used in the URL, so we build the Basic auth header manually).
 */

import * as vscode from 'vscode';
import type { PRProvider } from './provider';
import type { PRSummary } from './github';
import type { RemoteInfo } from '../remote';

export interface BitbucketPR {
	id: number;
	title: string;
	description: string;
	state: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED';
	links: { html: { href: string } };
	author: { display_name: string; nickname?: string };
}

export const BITBUCKET_API_BASE = 'https://api.bitbucket.org/2.0';

export function buildCommitPRsUrl(workspace: string, repo: string, sha: string): string {
	// URL-encode workspace and repo so they work with special characters
	return `${BITBUCKET_API_BASE}/repositories/${encodeURIComponent(
		workspace,
	)}/${encodeURIComponent(repo)}/commit/${encodeURIComponent(sha)}/pullrequests`;
}

/**
 * Map Bitbucket's PR state to our standard state strings.
 * OPEN → 'open', MERGED → 'merged', DECLINED/SUPERSEDED → 'closed'
 */
function mapBitbucketState(state: string): string {
	if (state === 'MERGED') return 'merged';
	if (state === 'OPEN') return 'open';
	if (state === 'DECLINED' || state === 'SUPERSEDED') return 'closed';
	return state.toLowerCase();
}

/**
 * Map a single Bitbucket PR to our compact PRSummary.
 */
export function adaptBitbucketPR(pr: Partial<BitbucketPR>): PRSummary & { author: string } {
	const state = mapBitbucketState(pr.state ?? '');
	const author = pr.author?.nickname ?? pr.author?.display_name ?? '';
	return {
		number: pr.id ?? 0,
		title: typeof pr.title === 'string' ? pr.title : '',
		body: typeof pr.description === 'string' ? pr.description : '',
		url: typeof pr.links?.html?.href === 'string' ? pr.links.html.href : '',
		state,
		merged: pr.state === 'MERGED',
		author,
	};
}

/**
 * Map Bitbucket's JSON response envelope to our compact PRSummary array.
 * Bitbucket wraps results in { values?: [...] }.
 */
export function parsePRsResponse(raw: unknown): Array<PRSummary & { author: string }> {
	if (!raw || typeof raw !== 'object') return [];
	const obj = raw as Record<string, unknown>;
	const values = obj.values;
	if (!Array.isArray(values)) return [];
	const out: Array<PRSummary & { author: string }> = [];
	for (const item of values) {
		if (!item || typeof item !== 'object') continue;
		const prObj = item as Record<string, unknown>;
		if (typeof prObj.id !== 'number') continue;
		out.push(adaptBitbucketPR(prObj as Partial<BitbucketPR>));
	}
	return out;
}

export interface FetchPRsInput {
	workspace: string;
	repo: string;
	sha: string;
	/** App password from timeTraveller.bitbucketAppPassword setting. */
	appPassword?: string;
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
	const { workspace, repo, sha, appPassword } = input;
	const fetchImpl = input.fetchImpl ?? fetch;
	const headers: Record<string, string> = {
		'User-Agent': 'vscode-time-traveller',
	};
	if (appPassword) {
		// Bitbucket Basic auth uses username:password; here we only have the app password,
		// so we use an empty username (the format is "username:password" and Bitbucket
		// recognizes app passwords).
		const auth = Buffer.from(`:${appPassword}`).toString('base64');
		headers.Authorization = `Basic ${auth}`;
	}
	try {
		const response = await fetchImpl(buildCommitPRsUrl(workspace, repo, sha), { headers });
		if (!response.ok) return undefined;
		const json = (await response.json()) as unknown;
		const prs = parsePRsResponse(json);
		// Strip the author field (non-PRSummary) before returning
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		return prs.map(({ author, ...rest }) => rest);
	} catch {
		return undefined;
	}
}

export class BitbucketProvider implements PRProvider {
	readonly id = 'bitbucket' as const;

	matches(remote: RemoteInfo): boolean {
		return remote.host === 'bitbucket';
	}

	async fetchForCommit(args: { remote: RemoteInfo; sha: string; token?: string }) {
		const appPassword = await this.getToken();
		return fetchPRsForCommit({
			workspace: args.remote.owner,
			repo: args.remote.repo,
			sha: args.sha,
			appPassword,
		});
	}

	async getToken() {
		const token = vscode.workspace
			.getConfiguration('timeTraveller')
			.get<string>('bitbucketAppPassword');
		return token || undefined;
	}
}
