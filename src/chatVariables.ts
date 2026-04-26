export interface CommitForVariable {
	shortSha: string;
	subject: string;
	authorName: string;
	authorDate: Date;
	body?: string;
}

export function formatBaselineValue(ref: string | undefined): string {
	return ref ? `Current diff baseline: \`${ref}\`` : 'No diff baseline set (defaults to HEAD)';
}

export function formatHistoryValue(relPath: string, commits: CommitForVariable[]): string {
	if (commits.length === 0) {
		return `No commits found for ${relPath}.`;
	}
	const lines = commits.map(
		(c) =>
			`- \`${c.shortSha}\` · ${c.authorName} · ${c.authorDate.toISOString().slice(0, 10)} — ${c.subject}`,
	);
	return [`Recent commits for ${relPath}:`, ...lines].join('\n');
}

export function formatCommitValue(commit: CommitForVariable | undefined): string {
	if (!commit) return 'No commit selected in the History panel';
	const head = `\`${commit.shortSha}\` · ${commit.authorName} · ${commit.authorDate.toISOString().slice(0, 10)} — ${commit.subject}`;
	return commit.body ? `${head}\n\n${commit.body}` : head;
}
