/**
 * GitLab REST client for "which MR introduced this commit?" lookups.
 *
 * The network-touching entry point is `fetchMRsForCommit`; everything else in
 * this file is pure so the URL shape and JSON mapping are testable without a
 * live network. GitLab's `/projects/{id}/repository/commits/{sha}/merge_requests`
 * endpoint returns an array of merge requests associated with the commit.
 *
 * The projectId is URL-encoded as `owner/repo`. For GitLab.com, the baseUrl
 * defaults to https://gitlab.com/api/v4; enterprise instances can be configured
 * via the timeTraveller.gitlabBaseUrl setting (not yet wired).
 */

import * as vscode from 'vscode';
import type { PRProvider } from './provider';
import type { PRSummary } from './github';
import type { RemoteInfo } from '../remote';

export interface GitLabMR {
	iid: number;
	title: string;
	description: string;
	state: string;
	web_url: string;
	author: { name: string };
}

export const GITLAB_API_BASE = 'https://gitlab.com/api/v4';

export function buildCommitMRsUrl(
	projectId: string,
	sha: string,
	baseUrl: string = GITLAB_API_BASE,
): string {
	// URL-encode the project ID (owner/repo becomes owner%2Frepo)
	const encodedId = encodeURIComponent(projectId);
	return `${baseUrl}/projects/${encodedId}/repository/commits/${encodeURIComponent(sha)}/merge_requests`;
}

/**
 * Map a GitLab MR to our compact PRSummary. Converts 'opened' state to 'open'
 * and marks merged=true only for 'merged' state. Defaults missing strings to empty.
 */
export function adaptGitLabMR(mr: Partial<GitLabMR>): PRSummary {
	const state = mr.state === 'opened' ? 'open' : (mr.state ?? '');
	return {
		number: mr.iid ?? 0,
		title: typeof mr.title === 'string' ? mr.title : '',
		body: typeof mr.description === 'string' ? mr.description : '',
		url: typeof mr.web_url === 'string' ? mr.web_url : '',
		state,
		merged: mr.state === 'merged',
	};
}

/**
 * Map GitLab's JSON array to our compact PRSummary array. Ignores entries
 * without an iid (shouldn't happen, but belt-and-braces).
 */
export function parseMRsResponse(raw: unknown): PRSummary[] {
	if (!Array.isArray(raw)) return [];
	const out: PRSummary[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const obj = item as Record<string, unknown>;
		if (typeof obj.iid !== 'number') continue;
		out.push(adaptGitLabMR(obj as Partial<GitLabMR>));
	}
	return out;
}

export interface FetchMRsInput {
	projectId: string;
	sha: string;
	token?: string;
	baseUrl?: string;
	fetchImpl?: typeof fetch;
}

/**
 * Fetches MRs associated with a single commit. Returns `undefined` on network
 * failure, non-2xx status, or JSON parse error — callers should treat
 * "unknown" as "don't mention MRs for this commit" rather than surfacing the
 * error, since MR context is a nice-to-have.
 */
export async function fetchMRsForCommit(input: FetchMRsInput): Promise<PRSummary[] | undefined> {
	const { projectId, sha, token, baseUrl } = input;
	const fetchImpl = input.fetchImpl ?? fetch;
	const headers: Record<string, string> = {
		'User-Agent': 'vscode-time-traveller',
	};
	if (token) headers['PRIVATE-TOKEN'] = token;
	try {
		const response = await fetchImpl(buildCommitMRsUrl(projectId, sha, baseUrl), { headers });
		if (!response.ok) return undefined;
		const json = (await response.json()) as unknown;
		return parseMRsResponse(json);
	} catch {
		return undefined;
	}
}

export class GitLabProvider implements PRProvider {
	readonly id = 'gitlab' as const;

	matches(remote: RemoteInfo): boolean {
		return remote.host === 'gitlab';
	}

	async fetchForCommit(args: { remote: RemoteInfo; sha: string; token?: string }) {
		const projectId = `${args.remote.owner}/${args.remote.repo}`;
		return fetchMRsForCommit({
			projectId,
			sha: args.sha,
			token: args.token,
		});
	}

	async getToken() {
		try {
			const session = await vscode.authentication.getSession('gitlab', [], {
				createIfNone: false,
				silent: true,
			});
			if (session?.accessToken) return session.accessToken;
		} catch {
			// Fall through to config check
		}

		// Fallback to timeTraveller.gitlabToken setting
		const token = vscode.workspace.getConfiguration('timeTraveller').get<string>('gitlabToken');
		return token || undefined;
	}
}
