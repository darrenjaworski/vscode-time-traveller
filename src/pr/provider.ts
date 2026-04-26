import type { RemoteInfo } from '../remote';
import type { PRSummary } from './github';

export type PRProviderId = 'github' | 'gitlab' | 'bitbucket' | 'github-enterprise';

export interface FetchArgs {
	remote: RemoteInfo;
	sha: string;
	token?: string;
}

export interface PRProvider {
	id: PRProviderId;
	matches(remote: RemoteInfo): boolean;
	fetchForCommit(args: FetchArgs): Promise<PRSummary[] | undefined>;
	getToken(): Promise<string | undefined>;
}

export function pickProvider(remote: RemoteInfo, providers: PRProvider[]): PRProvider | undefined {
	return providers.find((p) => p.matches(remote));
}
