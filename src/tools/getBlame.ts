import type { BlameLine } from '../git/cli';

export interface GetBlameInput {
	relPath: string;
	startLine: number;
	endLine: number;
}

export interface GetBlameDeps {
	repoRoot: string;
	blameRange: (
		repoRoot: string,
		relPath: string,
		startLine: number,
		endLine: number,
	) => Promise<BlameLine[]>;
}

/**
 * Pure helper for blame formatting. Returns formatted blame text for a range of lines.
 */
export async function getBlame(input: GetBlameInput, deps: GetBlameDeps): Promise<string> {
	const blame = await deps.blameRange(deps.repoRoot, input.relPath, input.startLine, input.endLine);

	if (blame.length === 0) {
		return 'No blame data available.';
	}

	const lines: string[] = [];
	for (const line of blame) {
		const date = new Date(line.authorTime * 1000).toLocaleDateString();
		const shortSha = line.sha.slice(0, 7);
		lines.push(`line ${line.line}: ${shortSha} ${line.author} (${date}) ${line.summary}`);
	}

	return lines.join('\n');
}
