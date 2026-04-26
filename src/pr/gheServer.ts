/**
 * GitHub Enterprise Server REST client for "which PR introduced this commit?" lookups.
 *
 * Uses the same fetchPRsForCommit function as the regular GitHub provider, but passes
 * a custom baseUrl pointing to the enterprise instance's API (https://{hostname}/api/v3).
 *
 * Token is read from the timeTraveller.gheToken setting.
 */

import * as vscode from 'vscode';
import { fetchPRsForCommit } from './github';
import type { PRProvider } from './provider';
import type { RemoteInfo } from '../remote';

export class GitHubEnterpriseProvider implements PRProvider {
	readonly id = 'github-enterprise' as const;

	matches(remote: RemoteInfo): boolean {
		return remote.host === 'github-enterprise';
	}

	async fetchForCommit(args: { remote: RemoteInfo; sha: string; token?: string }) {
		const token = await this.getToken();
		// Construct the baseUrl from the hostname: https://{hostname}/api/v3
		const baseUrl = `https://${args.remote.hostname}/api/v3`;
		return fetchPRsForCommit({
			owner: args.remote.owner,
			repo: args.remote.repo,
			sha: args.sha,
			token: token || args.token,
			baseUrl,
		});
	}

	async getToken() {
		const token = vscode.workspace.getConfiguration('timeTraveller').get<string>('gheToken');
		return token || undefined;
	}
}
